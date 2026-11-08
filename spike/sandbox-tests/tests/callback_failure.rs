//! Fault-injection sandbox proof: transfer receipt may finish while its callback fails.
//! Run only with an isolated WASM built with `--features fault-callback`.
use anyhow::{ensure, Result};
use near_workspaces::{types::NearToken, Account, Contract};
use serde_json::{json, Value};

const ONE_NEAR: u128 = 10_u128.pow(24);

async fn call(who: &Account, contract: &Contract, method: &str, args: Value, deposit: u128) -> Result<bool> {
    Ok(who.call(contract.id(), method).args_json(args)
        .deposit(NearToken::from_yoctonear(deposit)).max_gas().transact().await?.is_success())
}

async fn vault(contract: &Contract, owner: &Account) -> Result<Value> {
    Ok(contract.view("get_vault").args_json(json!({"owner": owner.id()})).await?.json()?)
}

async fn detail(contract: &Contract, owner: &Account, id: &str) -> Result<Value> {
    Ok(contract.view("get_payment_details")
        .args_json(json!({"owner": owner.id(), "id": id})).await?.json()?)
}

#[tokio::test]
#[ignore = "requires isolated fault-callback WASM"]
async fn failed_callbacks_keep_both_transfer_outcomes_locked() -> Result<()> {
    let path = std::env::var("AGENTSHIELD_FAULT_CALLBACK_WASM")?;
    let worker = near_workspaces::sandbox().await?;
    let contract = worker.dev_deploy(&std::fs::read(path)?).await?;
    ensure!(contract.call("new").max_gas().transact().await?.is_success(), "init failed");
    let owner = worker.dev_create_account().await?;
    let agent = worker.dev_create_account().await?;
    let vendor = worker.dev_create_account().await?;
    let absent = "absent-callback-fault-45783.testnet";
    let expiry = worker.view_block().await?.timestamp() + 24 * 60 * 60 * 1_000_000_000;
    let create = json!({"max_payment": (ONE_NEAR / 2).to_string(),
        "window_limit": ONE_NEAR.to_string(), "approval_threshold": (ONE_NEAR / 2).to_string(),
        "window_ns": 600_000_000_000_u64});
    ensure!(call(&owner, &contract, "create_vault", create, ONE_NEAR / 10).await?, "create failed");
    ensure!(call(&owner, &contract, "deposit", json!({}), ONE_NEAR).await?, "deposit failed");
    ensure!(call(&owner, &contract, "set_agent", json!({"agent": agent.id(), "expires_at_ns": expiry.to_string()}), 0).await?, "agent failed");
    for recipient in [vendor.id().to_string(), absent.to_string()] {
        ensure!(call(&owner, &contract, "set_recipient", json!({"recipient": recipient, "allowed": true}), 0).await?, "allowlist failed");
    }
    let version = vault(&contract, &owner).await?[5].as_u64().unwrap();
    let amount = ONE_NEAR / 10;
    let vendor_before = vendor.view_account().await?.balance.as_yoctonear();
    for (id, recipient) in [("success", vendor.id().to_string()), ("failure", absent.to_string())] {
        let request = json!({"owner": owner.id(), "id": id, "recipient": recipient,
            "amount": amount.to_string(), "policy_version": version});
        ensure!(call(&agent, &contract, "request_payment", request, 0).await?, "request failed");
        let outcome = agent.call(contract.id(), "execute_payment")
            .args_json(json!({"owner": owner.id(), "id": id}))
            .max_gas().transact().await?;
        println!("SANDBOX_TX case=callback-{id} hash={}", outcome.outcome().transaction_hash);
        for receipt in outcome.receipt_outcomes() {
            println!("SANDBOX_RECEIPT case=callback-{id} outcome_id={} executor={} success={} children={:?}",
                receipt.transaction_hash, receipt.executor_id, receipt.is_success(), receipt.receipt_ids);
        }
        ensure!(!outcome.receipt_failures().is_empty(), "fault callback did not fail");
        if id == "success" {
            ensure!(outcome.receipt_outcomes().iter().any(|r|
                r.executor_id == *vendor.id() && r.is_success()), "successful transfer receipt missing");
        } else {
            ensure!(outcome.receipt_outcomes().iter().any(|r|
                r.executor_id.as_str() == absent && !r.is_success()), "failed transfer receipt missing");
        }
        ensure!(detail(&contract, &owner, id).await?[0] == 3, "pending state was released");
        ensure!(!call(&agent, &contract, "execute_payment",
            json!({"owner": owner.id(), "id": id}), 0).await?, "pending replay accepted");
    }
    ensure!(vendor.view_account().await?.balance.as_yoctonear() == vendor_before + amount,
        "successful transfer did not reach vendor");
    let after_payments = vault(&contract, &owner).await?;
    ensure!(after_payments[0] == (ONE_NEAR - 2 * amount).to_string(),
        "available balance was incorrectly refunded");
    ensure!(after_payments[1] == (2 * amount).to_string(),
        "failed callbacks did not keep funds reserved");
    ensure!(after_payments[0].as_str().unwrap().parse::<u128>()?
        + after_payments[1].as_str().unwrap().parse::<u128>()? == ONE_NEAR,
        "available plus pending changed before callback resolution");
    ensure!(!call(&owner, &contract, "withdraw", json!({"amount": ONE_NEAR.to_string()}), 0).await?,
        "pending funds could be withdrawn");
    let owner_before = owner.view_account().await?.balance.as_yoctonear();
    let withdrawal = owner.call(contract.id(), "withdraw")
        .args_json(json!({"amount": amount.to_string()})).max_gas().transact().await?;
    ensure!(!withdrawal.receipt_failures().is_empty(), "withdraw callback did not fail");
    ensure!(withdrawal.receipt_outcomes().iter().any(|r|
        r.executor_id == *owner.id() && r.is_success()), "withdraw transfer receipt missing");
    ensure!(owner.view_account().await?.balance.as_yoctonear() > owner_before,
        "withdrawal did not reach owner");
    let after_withdrawal = vault(&contract, &owner).await?;
    ensure!(after_withdrawal[0] == (ONE_NEAR - 3 * amount).to_string(),
        "failed callback made withdrawn funds available");
    ensure!(after_withdrawal[1] == (3 * amount).to_string(),
        "withdrawal pending accounting missing");
    ensure!(after_withdrawal[0].as_str().unwrap().parse::<u128>()?
        + after_withdrawal[1].as_str().unwrap().parse::<u128>()? == ONE_NEAR,
        "available plus pending changed despite unresolved callbacks");
    let pending_withdrawal: Value = contract.view("get_pending_withdrawal")
        .args_json(json!({"owner": owner.id(), "nonce": 1})).await?.json()?;
    ensure!(pending_withdrawal == amount.to_string(), "withdrawal nonce lost");
    Ok(())
}
