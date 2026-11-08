use anyhow::{ensure, Result};
use near_workspaces::{types::NearToken, Account, Contract};
use serde_json::{json, Value};
use std::path::PathBuf;

const ONE_NEAR: u128 = 10_u128.pow(24);
const CREATE_STORAGE_DEPOSIT: u128 = ONE_NEAR / 100; // exact Meteor preview: 0.01 NEAR
const STORAGE_TOP_UP: u128 = 9 * ONE_NEAR / 100;

async fn call(owner: &Account, contract: &Contract, method: &str, args: Value, deposit: u128) -> Result<bool> {
    let outcome = owner.call(contract.id(), method)
        .args_json(args)
        .deposit(NearToken::from_yoctonear(deposit))
        .max_gas()
        .transact().await?;
    Ok(outcome.is_success())
}

async fn vault(contract: &Contract, owner: &Account) -> Result<Value> {
    Ok(contract.view("get_vault")
        .args_json(json!({"owner": owner.id()}))
        .await?.json()?)
}

async fn payment(contract: &Contract, owner: &Account, id: &str) -> Result<Value> {
    Ok(contract.view("get_payment")
        .args_json(json!({"owner": owner.id(), "id": id}))
        .await?.json()?)
}

#[tokio::test]
async fn two_owner_contract_receipts_and_recovery() -> Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../multitenant-contract/target/wasm32-unknown-unknown/release/agentshield_multitenant_spike.wasm");
    let contract = worker.dev_deploy(&std::fs::read(path)?).await?;
    ensure!(contract.call("new").max_gas().transact().await?.is_success(), "initializer failed");
    let owner_a = worker.dev_create_account().await?;
    let owner_b = worker.dev_create_account().await?;
    let agent_a = worker.dev_create_account().await?;
    let agent_b = worker.dev_create_account().await?;
    let vendor = worker.dev_create_account().await?;
    let absent = "absent-recipient-45783.testnet";
    let expiry = worker.view_block().await?.timestamp() + 24 * 60 * 60 * 1_000_000_000;
    let create = json!({"max_payment": (ONE_NEAR / 2).to_string(),
        "window_limit": ONE_NEAR.to_string(),
        "approval_threshold": (ONE_NEAR / 4).to_string(),
        "window_ns": 600_000_000_000_u64});
    let mut observed_storage = contract.view_account().await?.storage_usage;
    for owner in [&owner_a, &owner_b] {
        ensure!(call(owner, &contract, "create_vault", create.clone(), CREATE_STORAGE_DEPOSIT).await?, "create failed");
        let next_storage = contract.view_account().await?.storage_usage;
        ensure!(next_storage > observed_storage && next_storage - observed_storage < 1_000,
            "unexpected per-vault storage delta");
        observed_storage = next_storage;
        ensure!(vault(&contract, owner).await?[2] == CREATE_STORAGE_DEPOSIT.to_string(),
            "initial storage reserve differs from Meteor preview");
        ensure!(call(owner, &contract, "top_up_storage", json!({}), STORAGE_TOP_UP).await?, "storage top up failed");
        ensure!(call(owner, &contract, "deposit", json!({}), ONE_NEAR).await?, "funding failed");
    }
    ensure!(!call(&owner_a, &contract, "create_vault", create, CREATE_STORAGE_DEPOSIT).await?, "duplicate create accepted");
    ensure!(vault(&contract, &owner_a).await?[0] == ONE_NEAR.to_string(), "owner A balance");
    ensure!(vault(&contract, &owner_b).await?[0] == ONE_NEAR.to_string(), "owner B balance");
    for (owner, agent) in [(&owner_a, &agent_a), (&owner_b, &agent_b)] {
        ensure!(call(owner, &contract, "set_agent", json!({"agent": agent.id(), "expires_at_ns": expiry.to_string()}), 0).await?, "agent setup");
        ensure!(call(owner, &contract, "set_recipient", json!({"recipient": vendor.id(), "allowed": true}), 0).await?, "allowlist setup");
    }
    // Account A and its agent cannot spend B's grant or balance.
    let version_b = vault(&contract, &owner_b).await?[5].as_u64().unwrap();
    let unauthorized = json!({"owner": owner_b.id(), "id": "cross", "recipient": vendor.id(),
        "amount": (ONE_NEAR / 10).to_string(), "policy_version": version_b});
    ensure!(!call(&agent_a, &contract, "request_payment", unauthorized, 0).await?, "cross-owner request accepted");
    let version_a = vault(&contract, &owner_a).await?[5].as_u64().unwrap();
    let request = |id: &str, recipient: &str, amount: u128| json!({"owner": owner_a.id(),
        "id": id, "recipient": recipient, "amount": amount.to_string(), "policy_version": version_a});
    ensure!(!call(&agent_a, &contract, "request_payment", request("bad", absent, ONE_NEAR / 10), 0).await?, "unlisted recipient accepted");
    ensure!(!call(&agent_a, &contract, "request_payment", request("over", &vendor.id().to_string(), ONE_NEAR), 0).await?, "over-limit accepted");
    let vendor_before = vendor.view_account().await?.balance;
    let before_request_storage = contract.view_account().await?.storage_usage;
    ensure!(call(&agent_a, &contract, "request_payment", request("ok", &vendor.id().to_string(), ONE_NEAR / 10), 0).await?, "allowed request failed");
    ensure!(contract.view_account().await?.storage_usage > before_request_storage,
        "payment state did not consume storage");
    ensure!(!call(&agent_a, &contract, "request_payment", request("ok", &vendor.id().to_string(), ONE_NEAR / 10), 0).await?, "replay accepted");
    ensure!(!call(&owner_a, &contract, "on_transfer", json!({"owner": owner_a.id(), "id": "ok"}), 0).await?, "public callback accepted");
    let settled_receipt = agent_a.call(contract.id(), "execute_payment")
        .args_json(json!({"owner": owner_a.id(), "id": "ok"}))
        .max_gas().transact().await?;
    println!("SANDBOX_TX case=normal-success hash={}", settled_receipt.outcome().transaction_hash);
    for receipt in settled_receipt.receipt_outcomes() {
        println!("SANDBOX_RECEIPT case=normal-success outcome_id={} executor={} success={} children={:?}",
            receipt.transaction_hash, receipt.executor_id, receipt.is_success(), receipt.receipt_ids);
    }
    ensure!(settled_receipt.is_success() && settled_receipt.receipt_outcomes().len() >= 2
        && settled_receipt.receipt_failures().is_empty(), "execute receipts failed");
    ensure!(payment(&contract, &owner_a, "ok").await?[0] == 4, "payment not settled");
    ensure!(vendor.view_account().await?.balance.as_yoctonear() == vendor_before.as_yoctonear() + ONE_NEAR / 10, "recipient delta");
    ensure!(vault(&contract, &owner_a).await?[0] == (ONE_NEAR - ONE_NEAR / 10).to_string(), "A debit");
    ensure!(vault(&contract, &owner_b).await?[0] == ONE_NEAR.to_string(), "B changed");
    ensure!(!call(&agent_a, &contract, "execute_payment", json!({"owner": owner_a.id(), "id": "ok"}), 0).await?, "settled replay accepted");
    // A nonexistent named recipient causes a failed transfer receipt; callback restores exactly once.
    ensure!(call(&owner_a, &contract, "set_recipient", json!({"recipient": absent, "allowed": true}), 0).await?, "failed-target allowlist");
    let version_a = vault(&contract, &owner_a).await?[5].as_u64().unwrap();
    let failed = json!({"owner": owner_a.id(), "id": "fail", "recipient": absent,
        "amount": (ONE_NEAR / 10).to_string(), "policy_version": version_a});
    ensure!(call(&agent_a, &contract, "request_payment", failed, 0).await?, "failure-path request");
    let failed_receipt = agent_a.call(contract.id(), "execute_payment")
        .args_json(json!({"owner": owner_a.id(), "id": "fail"}))
        .max_gas().transact().await?;
    println!("SANDBOX_TX case=normal-failed-transfer hash={}", failed_receipt.outcome().transaction_hash);
    for receipt in failed_receipt.receipt_outcomes() {
        println!("SANDBOX_RECEIPT case=normal-failed-transfer outcome_id={} executor={} success={} children={:?}",
            receipt.transaction_hash, receipt.executor_id, receipt.is_success(), receipt.receipt_ids);
    }
    ensure!(!failed_receipt.receipt_failures().is_empty(), "failed transfer receipt missing");
    ensure!(payment(&contract, &owner_a, "fail").await?[0] == 5, "failed transfer status");
    ensure!(vault(&contract, &owner_a).await?[0] == (ONE_NEAR - ONE_NEAR / 10).to_string(), "refund mismatch");
    ensure!(!call(&agent_a, &contract, "execute_payment", json!({"owner": owner_a.id(), "id": "fail"}), 0).await?, "failed ID replay accepted");
    let retry = json!({"owner": owner_a.id(), "id": "retry", "recipient": vendor.id(),
        "amount": (ONE_NEAR / 10).to_string(), "policy_version": version_a});
    ensure!(call(&agent_a, &contract, "request_payment", retry, 0).await?, "new ID after failure rejected");
    ensure!(call(&agent_a, &contract, "execute_payment", json!({"owner": owner_a.id(), "id": "retry"}), 0).await?, "retry execute");
    ensure!(payment(&contract, &owner_a, "retry").await?[0] == 4, "retry not settled");
    ensure!(call(&owner_a, &contract, "withdraw", json!({"amount": (ONE_NEAR / 5).to_string()}), 0).await?, "withdraw failed");
    ensure!(vault(&contract, &owner_a).await?[0] == (ONE_NEAR - 2 * ONE_NEAR / 10 - ONE_NEAR / 5).to_string(), "withdraw mismatch");
    ensure!(vault(&contract, &owner_b).await?[0] == ONE_NEAR.to_string(), "B changed after withdraw");
    Ok(())
}

#[tokio::test]
async fn max_records_and_allowlist_callback_settles_without_double_refund() -> Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../multitenant-contract/target/wasm32-unknown-unknown/release/agentshield_multitenant_spike.wasm");
    let contract = worker.dev_deploy(&std::fs::read(path)?).await?;
    ensure!(contract.call("new").max_gas().transact().await?.is_success(), "init failed");
    let owner = worker.dev_create_account().await?;
    let agent = worker.dev_create_account().await?;
    let vendor = worker.dev_create_account().await?;
    let expiry = worker.view_block().await?.timestamp() + 24 * 60 * 60 * 1_000_000_000;
    let create = json!({"max_payment": (ONE_NEAR / 2).to_string(),
        "window_limit": ONE_NEAR.to_string(),
        "approval_threshold": (ONE_NEAR / 4).to_string(),
        "window_ns": 600_000_000_000_u64});
    ensure!(call(&owner, &contract, "create_vault", create, CREATE_STORAGE_DEPOSIT).await?, "create failed");
    ensure!(call(&owner, &contract, "top_up_storage", json!({}), ONE_NEAR).await?, "storage top up failed");
    ensure!(call(&owner, &contract, "deposit", json!({}), ONE_NEAR).await?, "deposit failed");
    ensure!(call(&owner, &contract, "set_agent", json!({"agent": agent.id(), "expires_at_ns": expiry.to_string()}), 0).await?, "agent failed");
    ensure!(call(&owner, &contract, "set_recipient", json!({"recipient": vendor.id(), "allowed": true}), 0).await?, "vendor allowlist failed");
    for n in 0..31 {
        let recipient = format!("recipient-{n:02}-with-long-account-id-for-storage-pressure.testnet");
        ensure!(call(&owner, &contract, "set_recipient", json!({"recipient": recipient, "allowed": true}), 0).await?, "allowlist fill failed");
    }
    let version = vault(&contract, &owner).await?[5].as_u64().unwrap();
    for n in 0..64 {
        let id = format!("{n:02}-{}", "x".repeat(61));
        let recipient = if n == 63 { vendor.id().to_string() } else {
            format!("recipient-{:02}-with-long-account-id-for-storage-pressure.testnet", n % 31)
        };
        let request = json!({"owner": owner.id(), "id": id, "recipient": recipient,
            "amount": (ONE_NEAR / 1000).to_string(), "policy_version": version});
        ensure!(call(&agent, &contract, "request_payment", request, 0).await?, "payment record fill failed");
    }
    let id = format!("63-{}", "x".repeat(61));
    let vendor_before = vendor.view_account().await?.balance.as_yoctonear();
    let outcome = agent.call(contract.id(), "execute_payment")
        .args_json(json!({"owner": owner.id(), "id": id}))
        .max_gas().transact().await?;
    ensure!(outcome.is_success() && outcome.receipt_failures().is_empty(), "max-state callback failed");
    ensure!(payment(&contract, &owner, &id).await?[0] == 4, "max-state payment not settled");
    ensure!(vault(&contract, &owner).await?[0] == (ONE_NEAR - ONE_NEAR / 1000).to_string(), "incorrect debit");
    ensure!(vendor.view_account().await?.balance.as_yoctonear() == vendor_before + ONE_NEAR / 1000, "recipient delta");
    ensure!(!call(&agent, &contract, "execute_payment", json!({"owner": owner.id(), "id": id}), 0).await?, "replay accepted");
    Ok(())
}
