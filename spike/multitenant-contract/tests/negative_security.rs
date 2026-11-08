//! Contract VM tests use isolated in-memory state; amounts match Vault A's policy.
use agentshield_multitenant_spike::Contract;
use near_sdk::json_types::{U128, U64};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, AccountId, NearToken, PromiseError};

const NEAR: u128 = 10_u128.pow(24);
const WINDOW: u64 = 600_000_000_000;
fn id(s: &str) -> AccountId { s.parse().unwrap() }
fn ctx(who: &str, time: u64) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(id("arena.testnet"))
        .predecessor_account_id(id(who))
        .account_balance(NearToken::from_near(10))
        .block_timestamp(time);
    testing_env!(b.build());
}
fn reject(f: impl FnOnce()) {
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)).is_err());
}
fn ready() -> Contract {
    ctx("arena.testnet", 1);
    let mut c = Contract::new();
    for owner in ["a.testnet", "b.testnet"] {
        let mut b = VMContextBuilder::new();
        b.current_account_id(id("arena.testnet"))
            .predecessor_account_id(id(owner))
            .account_balance(NearToken::from_near(10))
            .attached_deposit(NearToken::from_millinear(100))
            .block_timestamp(1);
        testing_env!(b.build());
        c.create_vault(U128(NEAR / 20), U128(NEAR / 10), U128(NEAR / 40), WINDOW);
        b.attached_deposit(NearToken::from_near(1));
        testing_env!(b.build());
        c.deposit();
        ctx(owner, 1);
        c.set_agent(Some(id(if owner == "a.testnet" { "agent.testnet" } else { "other-agent.testnet" })), U64(2 * WINDOW));
        c.set_recipient(id("vendor.testnet"), true);
    }
    c
}
fn request(c: &mut Contract, name: &str, amount: u128, time: u64) -> u8 {
    ctx("agent.testnet", time);
    let version = c.get_vault(id("a.testnet")).unwrap().5;
    c.request_payment(id("a.testnet"), name.into(), id("vendor.testnet"), U128(amount), version)
}

#[test]
fn revoked_agent_cannot_request_or_execute_existing_payment() {
    let mut c = ready();
    assert_eq!(request(&mut c, "before-revoke", NEAR / 100, 1), 0);
    ctx("a.testnet", 1);
    c.set_agent(None, U64(0));
    reject(|| { request(&mut c, "after-revoke", NEAR / 100, 1); });
    ctx("agent.testnet", 1);
    reject(|| { let _ = c.execute_payment(id("a.testnet"), "before-revoke".into()); });
    assert_eq!(c.get_payment(id("a.testnet"), "before-revoke".into()).unwrap().0, 0);
    assert_eq!(c.get_vault(id("a.testnet")).unwrap().0 .0, NEAR);
}

#[test]
fn agent_cannot_withdraw_or_change_owner_policy() {
    let mut c = ready();
    ctx("agent.testnet", 1);
    reject(|| { let _ = c.withdraw(U128(NEAR / 100)); });
    reject(|| c.set_agent(Some(id("attacker.testnet")), U64(WINDOW)));
    reject(|| c.set_recipient(id("attacker.testnet"), true));
    assert_eq!(c.get_vault(id("a.testnet")).unwrap().0 .0, NEAR);
    assert_eq!(c.get_vault(id("a.testnet")).unwrap().3, Some(id("agent.testnet")));
}

#[test]
fn exact_payment_cap_allowlist_and_owner_approval() {
    let mut c = ready();
    ctx("agent.testnet", 1);
    let version = c.get_vault(id("a.testnet")).unwrap().5;
    reject(|| { c.request_payment(id("a.testnet"), "denied".into(), id("denied.testnet"), U128(NEAR / 100), version); });
    reject(|| { c.request_payment(id("a.testnet"), "over".into(), id("vendor.testnet"), U128(NEAR / 20 + 1), version); });
    assert_eq!(request(&mut c, "approval", NEAR / 40 + 1, 1), 1);
    ctx("agent.testnet", 1);
    reject(|| { let _ = c.execute_payment(id("a.testnet"), "approval".into()); });
    ctx("a.testnet", 1);
    c.approve_payment("approval".into());
    ctx("agent.testnet", 1);
    let _ = c.execute_payment(id("a.testnet"), "approval".into());
    assert_eq!(c.get_payment(id("a.testnet"), "approval".into()).unwrap().0, 3);
}

#[test]
fn window_limit_reserves_pending_and_rejects_concurrent_replay() {
    let mut c = ready();
    for name in ["first", "second", "third"] { assert_eq!(request(&mut c, name, NEAR / 25, 1), 1); }
    ctx("a.testnet", 1);
    for name in ["first", "second", "third"] { c.approve_payment(name.into()); }
    ctx("agent.testnet", 1);
    let _ = c.execute_payment(id("a.testnet"), "first".into());
    reject(|| { let _ = c.execute_payment(id("a.testnet"), "first".into()); });
    let _ = c.execute_payment(id("a.testnet"), "second".into());
    reject(|| { let _ = c.execute_payment(id("a.testnet"), "third".into()); });
    assert_eq!(c.get_vault(id("a.testnet")).unwrap().1 .0, 2 * NEAR / 25);
    ctx("arena.testnet", 1);
    assert_eq!(c.on_transfer(id("a.testnet"), "first".into(), Ok(())), 4);
    reject(|| { c.on_transfer(id("a.testnet"), "first".into(), Ok(())); });
    ctx("agent.testnet", 1);
    reject(|| { let _ = c.execute_payment(id("a.testnet"), "third".into()); });
    assert_eq!(c.get_vault(id("b.testnet")).unwrap().0 .0, NEAR);
}

#[test]
fn expired_grant_and_cross_tenant_execution_are_rejected() {
    let mut c = ready();
    assert_eq!(request(&mut c, "existing", NEAR / 100, 1), 0);
    ctx("agent.testnet", 2 * WINDOW);
    reject(|| { let _ = c.execute_payment(id("a.testnet"), "existing".into()); });
    reject(|| { request(&mut c, "expired", NEAR / 100, 2 * WINDOW); });
    ctx("agent.testnet", 1);
    reject(|| { let _ = c.execute_payment(id("b.testnet"), "existing".into()); });
    let version = c.get_vault(id("b.testnet")).unwrap().5;
    reject(|| { c.request_payment(id("b.testnet"), "cross".into(), id("vendor.testnet"), U128(NEAR / 100), version); });
    assert_eq!(c.get_vault(id("b.testnet")).unwrap().0 .0, NEAR);
}

#[test]
fn failed_transfer_releases_pending_once_but_id_is_consumed() {
    let mut c = ready();
    request(&mut c, "failed", NEAR / 100, 1);
    ctx("agent.testnet", 1);
    let _ = c.execute_payment(id("a.testnet"), "failed".into());
    ctx("arena.testnet", 1);
    assert_eq!(c.on_transfer(id("a.testnet"), "failed".into(), Err(PromiseError::Failed)), 5);
    reject(|| { c.on_transfer(id("a.testnet"), "failed".into(), Err(PromiseError::Failed)); });
    ctx("agent.testnet", 1);
    reject(|| { let _ = c.execute_payment(id("a.testnet"), "failed".into()); });
    reject(|| { request(&mut c, "failed", NEAR / 100, 1); });
    assert_eq!(c.get_vault(id("a.testnet")).unwrap().0 .0, NEAR);
    assert_eq!(c.get_vault(id("a.testnet")).unwrap().1 .0, 0);
}
