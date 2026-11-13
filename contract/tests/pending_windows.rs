use agentshield_multitenant_spike::Contract;
use near_sdk::borsh::{self, BorshDeserialize};
use near_sdk::json_types::{U128, U64};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, AccountId, NearToken, PromiseError};

fn id(value: &str) -> AccountId { value.parse().unwrap() }

fn context(predecessor: &str, deposit: u128, timestamp: u64) {
    let mut builder = VMContextBuilder::new();
    builder.current_account_id(id("arena.testnet"))
        .predecessor_account_id(id(predecessor))
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .account_balance(NearToken::from_near(10))
        .block_timestamp(timestamp);
    testing_env!(builder.build());
}

fn ready() -> Contract {
    context("arena.testnet", 0, 1);
    let mut contract = Contract::new();
    context("owner.testnet", NearToken::from_millinear(100).as_yoctonear(), 1);
    contract.create_vault(U128(50), U128(60), U128(25), 100);
    context("owner.testnet", 100, 1);
    contract.deposit();
    context("owner.testnet", 0, 1);
    contract.set_agent(Some(id("agent.testnet")), U64(1000));
    contract.set_recipient(id("vendor.testnet"), true);
    contract
}

fn request(contract: &mut Contract, payment_id: &str, timestamp: u64) {
    let version = contract.get_vault(id("owner.testnet")).unwrap().5;
    context("owner.testnet", 0, timestamp);
    contract.authorize_payment(payment_id.into(), id("agent.testnet"), id("vendor.testnet"), U128(40), version, U64(900));
    context("agent.testnet", 0, timestamp);
    contract.request_payment(id("owner.testnet"), payment_id.into(), id("vendor.testnet"), U128(40), version);
    context("owner.testnet", 0, timestamp);
    contract.approve_payment(payment_id.into());
}

#[test]
fn pending_reserves_budget_and_failed_callback_releases_it() {
    let mut contract = ready();
    request(&mut contract, "first", 1);
    request(&mut contract, "second", 1);
    context("agent.testnet", 0, 1);
    let _ = contract.execute_payment(id("owner.testnet"), "first".into());
    assert_eq!(contract.get_vault(id("owner.testnet")).unwrap().1 .0, 40);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _ = contract.execute_payment(id("owner.testnet"), "second".into());
    })).is_err());
    context("arena.testnet", 0, 1);
    contract.on_transfer(id("owner.testnet"), "first".into(), Err(PromiseError::Failed));
    assert_eq!(contract.get_vault(id("owner.testnet")).unwrap().0 .0, 100);
    context("agent.testnet", 0, 1);
    let _ = contract.execute_payment(id("owner.testnet"), "second".into());
    assert_eq!(contract.get_vault(id("owner.testnet")).unwrap().1 .0, 40);
}

#[test]
fn old_window_callback_does_not_release_new_window_budget() {
    let mut contract = ready();
    request(&mut contract, "old", 1);
    context("agent.testnet", 0, 1);
    let _ = contract.execute_payment(id("owner.testnet"), "old".into());
    request(&mut contract, "new", 101);
    context("agent.testnet", 0, 101);
    let _ = contract.execute_payment(id("owner.testnet"), "new".into());
    context("arena.testnet", 0, 101);
    contract.on_transfer(id("owner.testnet"), "old".into(), Err(PromiseError::Failed));
    assert_eq!(contract.get_vault(id("owner.testnet")).unwrap().1 .0, 40);
    contract.on_transfer(id("owner.testnet"), "new".into(), Ok(()));
    assert_eq!(contract.get_vault(id("owner.testnet")).unwrap().1 .0, 0);
    assert_eq!(contract.get_vault(id("owner.testnet")).unwrap().0 .0, 60);
}

#[test]
fn overlapping_payment_and_withdrawal_refund_only_failed_transfer() {
    let mut contract = ready();
    request(&mut contract, "payment", 1);
    context("agent.testnet", 0, 1);
    let _ = contract.execute_payment(id("owner.testnet"), "payment".into());
    context("owner.testnet", 0, 1);
    let _ = contract.withdraw(U128(50));
    let during = contract.get_vault(id("owner.testnet")).unwrap();
    assert_eq!(during.0 .0, 10);
    assert_eq!(during.1 .0, 90);
    context("arena.testnet", 0, 1);
    contract.on_transfer(id("owner.testnet"), "payment".into(), Err(PromiseError::Failed));
    let after_payment = contract.get_vault(id("owner.testnet")).unwrap();
    assert_eq!(after_payment.0 .0, 50);
    assert_eq!(after_payment.1 .0, 50);
    contract.on_withdraw(id("owner.testnet"), 1, Ok(()));
    let final_state = contract.get_vault(id("owner.testnet")).unwrap();
    assert_eq!(final_state.0 .0, 50);
    assert_eq!(final_state.1 .0, 0);
    assert_eq!(contract.get_payment(id("owner.testnet"), "payment".into()).unwrap().0, 5);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        contract.on_withdraw(id("owner.testnet"), 1, Err(PromiseError::Failed));
    })).is_err());
}

#[test]
fn pending_details_remain_auditable_and_control_characters_are_rejected() {
    let mut contract = ready();
    context("agent.testnet", 0, 1);
    let version = contract.get_vault(id("owner.testnet")).unwrap().5;
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        contract.request_payment(id("owner.testnet"), "bad\nline".into(),
            id("vendor.testnet"), U128(10), version);
    })).is_err());
    request(&mut contract, "review", 1);
    context("agent.testnet", 0, 1);
    let _ = contract.execute_payment(id("owner.testnet"), "review".into());
    let detail = contract.get_payment_details(id("owner.testnet"), "review".into()).unwrap();
    assert_eq!(detail.0, 3);
    assert_eq!(detail.1 .0, 40);
    assert_eq!(detail.2, id("vendor.testnet"));
    assert_eq!(detail.3, version);
    context("owner.testnet", 0, 1);
    let _ = contract.withdraw(U128(20));
    assert_eq!(contract.get_pending_withdrawal(id("owner.testnet"), 1).unwrap().0, 20);
    context("arena.testnet", 0, 1);
    contract.on_withdraw(id("owner.testnet"), 1, Ok(()));
    assert!(contract.get_pending_withdrawal(id("owner.testnet"), 1).is_none());
}

#[test]
fn pending_state_survives_serialization_before_callback() {
    let mut contract = ready();
    let version = contract.get_vault(id("owner.testnet")).unwrap().5;
    context("owner.testnet", 0, 1);
    contract.authorize_payment("restart".into(), id("agent.testnet"), id("vendor.testnet"), U128(20), version, U64(900));
    context("agent.testnet", 0, 1);
    contract.request_payment(id("owner.testnet"), "restart".into(),
        id("vendor.testnet"), U128(20), version);
    let _ = contract.execute_payment(id("owner.testnet"), "restart".into());
    let bytes = borsh::to_vec(&contract).unwrap();
    let mut restored = Contract::try_from_slice(&bytes).unwrap();
    assert_eq!(restored.get_vault(id("owner.testnet")).unwrap().1 .0, 20);
    assert_eq!(restored.get_payment(id("owner.testnet"), "restart".into()).unwrap().0, 3);
    context("agent.testnet", 0, 1);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _ = restored.execute_payment(id("owner.testnet"), "restart".into());
    })).is_err());
    context("arena.testnet", 0, 1);
    assert_eq!(restored.on_transfer(id("owner.testnet"), "restart".into(), Ok(())), 4);
    assert_eq!(restored.get_vault(id("owner.testnet")).unwrap().0 .0, 80);
    assert_eq!(restored.get_vault(id("owner.testnet")).unwrap().1 .0, 0);
}

#[test]
fn concurrent_pending_callbacks_resolve_in_reverse_order() {
    let mut contract = ready();
    let version = contract.get_vault(id("owner.testnet")).unwrap().5;
    for name in ["first", "second"] {
        context("owner.testnet", 0, 1);
        contract.authorize_payment(name.into(), id("agent.testnet"), id("vendor.testnet"), U128(20), version, U64(900));
        context("agent.testnet", 0, 1);
        contract.request_payment(id("owner.testnet"), name.into(),
            id("vendor.testnet"), U128(20), version);
        let _ = contract.execute_payment(id("owner.testnet"), name.into());
    }
    assert_eq!(contract.get_vault(id("owner.testnet")).unwrap().1 .0, 40);
    context("arena.testnet", 0, 1);
    assert_eq!(contract.on_transfer(id("owner.testnet"), "second".into(), Err(PromiseError::Failed)), 5);
    assert_eq!(contract.on_transfer(id("owner.testnet"), "first".into(), Ok(())), 4);
    assert_eq!(contract.get_vault(id("owner.testnet")).unwrap().0 .0, 80);
    assert_eq!(contract.get_vault(id("owner.testnet")).unwrap().1 .0, 0);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        contract.on_transfer(id("owner.testnet"), "second".into(), Ok(()));
    })).is_err());
}
