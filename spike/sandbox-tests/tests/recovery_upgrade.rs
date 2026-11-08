//! Local-only, case-specific code upgrades. All accounts live in NEAR sandbox.
use anyhow::{ensure, Result};
use near_workspaces::{types::NearToken, Account, Contract};
use serde_json::{json, Value};

const ONE: u128 = 10_u128.pow(24);
const AMOUNT: u128 = ONE / 10;
const ABSENT: &str = "absent-recovery.test.near";

fn wasm(name: &str) -> Result<Vec<u8>> {
    let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..").join(std::env::var(name)?);
    Ok(std::fs::read(path)?)
}

async fn view(contract: &Contract, owner: &Account) -> Result<Value> {
    Ok(contract.view("get_vault").args_json(json!({"owner": owner.id()})).await?.json()?)
}

async fn payment(contract: &Contract, owner: &Account, id: &str) -> Result<Value> {
    Ok(contract.view("get_payment_details")
        .args_json(json!({"owner": owner.id(), "id": id})).await?.json()?)
}

async fn ok(who: &Account, contract: &Contract, method: &str, args: Value, deposit: u128) -> Result<()> {
    let result = who.call(contract.id(), method).args_json(args)
        .deposit(NearToken::from_yoctonear(deposit)).max_gas().transact().await?;
    ensure!(result.is_success(), "{method} failed: {result:?}");
    Ok(())
}

async fn run_case(success: bool) -> Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let root = worker.root_account()?;
    ensure!(root.id().as_str() == "test.near", "unexpected sandbox root");
    let arena = root.create_subaccount("arena").initial_balance(NearToken::from_near(30))
        .transact().await?.into_result()?;
    let owner = root.create_subaccount("owner").initial_balance(NearToken::from_near(10))
        .transact().await?.into_result()?;
    let other = root.create_subaccount("other").initial_balance(NearToken::from_near(10))
        .transact().await?.into_result()?;
    let agent = root.create_subaccount("agent").initial_balance(NearToken::from_near(10))
        .transact().await?.into_result()?;
    let vendor = root.create_subaccount("vendor").initial_balance(NearToken::from_near(10))
        .transact().await?.into_result()?;
    let mut contract = arena.deploy(&wasm("AGENTSHIELD_FAULT_CALLBACK_WASM")?)
        .await?.into_result()?;
    ensure!(contract.call("new").max_gas().transact().await?.is_success(), "init failed");
    let create = json!({"max_payment": (ONE / 2).to_string(),
        "window_limit": ONE.to_string(), "approval_threshold": (ONE / 2).to_string(),
        "window_ns": 600_000_000_000_u64});
    for account in [&owner, &other] {
        ok(account, &contract, "create_vault", create.clone(), ONE / 10).await?;
        ok(account, &contract, "deposit", json!({}), ONE).await?;
    }
    let other_before = view(&contract, &other).await?;
    let expiry = worker.view_block().await?.timestamp() + 24 * 60 * 60 * 1_000_000_000;
    ok(&owner, &contract, "set_agent",
        json!({"agent": agent.id(), "expires_at_ns": expiry.to_string()}), 0).await?;
    for recipient in [vendor.id().as_str(), ABSENT] {
        ok(&owner, &contract, "set_recipient",
            json!({"recipient": recipient, "allowed": true}), 0).await?;
    }
    let id = if success { "recover-success" } else { "recover-failure" };
    let recipient = if success { vendor.id().as_str() } else { ABSENT };
    let version = view(&contract, &owner).await?[5].as_u64().unwrap();
    ensure!(version == 4, "manifest policy version drifted");
    let contract_before = contract.view_account().await?;
    ok(&agent, &contract, "request_payment", json!({"owner": owner.id(),
        "id": id, "recipient": recipient, "amount": AMOUNT.to_string(),
        "policy_version": version}), 0).await?;
    let vendor_before = vendor.view_account().await?.balance.as_yoctonear();
    let execute = agent.call(contract.id(), "execute_payment")
        .args_json(json!({"owner": owner.id(), "id": id}))
        .max_gas().transact().await?;
    ensure!(!execute.receipt_failures().is_empty(), "callback did not fail");
    ensure!(execute.receipt_outcomes().iter().any(|r|
        r.executor_id.as_str() == recipient && r.is_success() == success),
        "transfer outcome differs from expected case");
    ensure!(execute.receipt_outcomes().iter().any(|r|
        r.executor_id == *contract.id() && !r.is_success()), "callback failure missing");
    println!("TRANSACTION case={id} hash={}", execute.outcome().transaction_hash);
    for r in execute.receipt_outcomes() {
        println!("RECEIPT case={id} outcome_id={} executor={} success={} gas={} children={:?}",
            r.transaction_hash, r.executor_id, r.is_success(), r.gas_burnt.as_gas(), r.receipt_ids);
    }
    let pending = view(&contract, &owner).await?;
    ensure!(pending[0] == (ONE - AMOUNT).to_string() && pending[1] == AMOUNT.to_string(),
        "pending accounting wrong");
    ensure!(payment(&contract, &owner, id).await?[0] == 3, "payment not pending");
    let vendor_after_transfer = vendor.view_account().await?.balance.as_yoctonear();
    ensure!(vendor_after_transfer == vendor_before + if success { AMOUNT } else { 0 },
        "vendor balance mismatch");
    let pre_upgrade = contract.view_account().await?;
    println!("BEFORE case={id} vault={pending} vendor={} contract_balance={} storage={} execute_gas={}",
        vendor_after_transfer, pre_upgrade.balance.as_yoctonear(),
        pre_upgrade.storage_usage, execute.total_gas_burnt.as_gas());
    ensure!(contract_before.storage_usage < pre_upgrade.storage_usage,
        "request storage did not grow");

    if success {
        for name in ["AGENTSHIELD_RECOVERY_WRONG_OWNER_WASM",
            "AGENTSHIELD_RECOVERY_WRONG_AMOUNT_WASM", "AGENTSHIELD_RECOVERY_WRONG_ID_WASM"] {
            let upgrade = contract.as_account().deploy(&wasm(name)?).await?;
            ensure!(upgrade.is_success(), "invalid fixture deployment failed");
            println!("INVALID_UPGRADE kind={name} gas={}", upgrade.details.total_gas_burnt.as_gas());
            contract = upgrade.into_result()?;
            ensure!(!contract.call("recover_case").max_gas().transact().await?.is_success(),
                "invalid manifest recovered funds: {name}");
            ensure!(view(&contract, &owner).await? == pending &&
                view(&contract, &other).await? == other_before,
                "invalid manifest mutated a vault");
        }
    }
    let recovery_name = if success { "AGENTSHIELD_RECOVERY_SUCCESS_WASM" }
        else { "AGENTSHIELD_RECOVERY_FAILURE_WASM" };
    let upgrade = contract.as_account().deploy(&wasm(recovery_name)?).await?;
    ensure!(upgrade.is_success(), "recovery deployment failed");
    let upgrade_gas = upgrade.details.total_gas_burnt.as_gas();
    contract = upgrade.into_result()?;
    let upgraded = contract.view_account().await?;
    ensure!(upgraded.storage_usage != pre_upgrade.storage_usage,
        "recovery code size unexpectedly identical");
    ensure!(contract.view_code().await? == wasm(recovery_name)?,
        "sandbox upgrade bytes mismatch");
    ensure!(!owner.call(contract.id(), "recover_case").max_gas().transact().await?.is_success(),
        "external recovery accepted");
    ensure!(!agent.call(contract.id(), "request_payment")
        .args_json(json!({"owner": owner.id(), "id": "new-during-recovery",
            "recipient": vendor.id(), "amount": AMOUNT.to_string(),
            "policy_version": version}))
        .max_gas().transact().await?.is_success(), "new request accepted during freeze");
    ensure!(!agent.call(contract.id(), "execute_payment")
        .args_json(json!({"owner": owner.id(), "id": id}))
        .max_gas().transact().await?.is_success(), "payment executed during freeze");
    ensure!(!owner.call(contract.id(), "withdraw")
        .args_json(json!({"amount": AMOUNT.to_string()}))
        .max_gas().transact().await?.is_success(), "withdrawal executed during freeze");
    let recovered = contract.call("recover_case").max_gas().transact().await?;
    ensure!(recovered.is_success(), "recovery failed: {recovered:?}");
    ensure!(recovered.receipt_outcomes().iter().all(|r| r.executor_id == *contract.id()),
        "recovery issued outgoing receipt");
    let after = view(&contract, &owner).await?;
    let expected_available = if success { ONE - AMOUNT } else { ONE };
    ensure!(after[0] == expected_available.to_string() && after[1] == "0",
        "recovery accounting mismatch: {after}");
    ensure!(payment(&contract, &owner, id).await?[0] == if success { 4 } else { 5 },
        "recovery status mismatch");
    ensure!(view(&contract, &other).await? == other_before, "foreign vault changed");
    ensure!(vendor.view_account().await?.balance.as_yoctonear() == vendor_after_transfer,
        "recovery paid vendor again");
    ensure!(!contract.call("recover_case").max_gas().transact().await?.is_success(),
        "repeated recovery accepted");
    let recovery_state = contract.view_account().await?;
    println!("RECOVERED case={id} vault={after} vendor={} contract_balance={} storage={} upgrade_gas={} recovery_gas={}",
        vendor_after_transfer, recovery_state.balance.as_yoctonear(),
        recovery_state.storage_usage, upgrade_gas, recovered.total_gas_burnt.as_gas());

    let restore = contract.as_account().deploy(&wasm("AGENTSHIELD_NORMAL_WASM")?).await?;
    ensure!(restore.is_success(), "normal WASM restore failed");
    let restore_gas = restore.details.total_gas_burnt.as_gas();
    contract = restore.into_result()?;
    let restored = contract.view_account().await?;
    let expected_storage = pre_upgrade.storage_usage
        - wasm("AGENTSHIELD_FAULT_CALLBACK_WASM")?.len() as u64
        + wasm("AGENTSHIELD_NORMAL_WASM")?.len() as u64;
    ensure!(restored.storage_usage == expected_storage,
        "storage layout/normal code did not restore: actual={} expected={}",
        restored.storage_usage, expected_storage);
    ensure!(contract.view_code().await? == wasm("AGENTSHIELD_NORMAL_WASM")?,
        "normal WASM bytes not restored");
    ensure!(restored.balance.as_yoctonear() >= expected_available + ONE
        + (restored.storage_usage as u128) * 10_u128.pow(19) + ONE / 10,
        "contract insolvent after restore");
    ensure!(view(&contract, &owner).await? == after &&
        view(&contract, &other).await? == other_before,
        "state changed on restore");
    ensure!(!agent.call(contract.id(), "execute_payment")
        .args_json(json!({"owner": owner.id(), "id": id}))
        .max_gas().transact().await?.is_success(), "recovered ID replayed after restore");
    println!("RESTORED case={id} vault={after} vendor={} contract_balance={} storage={} restore_gas={}",
        vendor.view_account().await?.balance.as_yoctonear(),
        restored.balance.as_yoctonear(), restored.storage_usage, restore_gas);
    Ok(())
}

#[tokio::test]
#[ignore = "requires isolated normal, fault and recovery WASMs"]
async fn successful_transfer_failed_callback_recovery_upgrade() -> Result<()> {
    run_case(true).await
}

#[tokio::test]
#[ignore = "requires isolated normal, fault and recovery WASMs"]
async fn failed_transfer_failed_callback_recovery_upgrade() -> Result<()> {
    run_case(false).await
}
