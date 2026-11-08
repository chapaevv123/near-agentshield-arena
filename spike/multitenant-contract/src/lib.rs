use std::collections::{BTreeMap, BTreeSet};
use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::json_types::{U128, U64};
use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError};

const CALLBACK_GAS: Gas = Gas::from_tgas(40);
const MIN_BUFFER: u128 = 100_000_000_000_000_000_000_000; // 0.1 NEAR
const MAX_RECORDS: usize = 64;
const MIN_STORAGE_DEPOSIT: u128 = 10_000_000_000_000_000_000_000; // 0.01 NEAR
const MAX_GRANT_NS: u64 = 30 * 24 * 60 * 60 * 1_000_000_000;

#[derive(BorshDeserialize, BorshSerialize)]
#[borsh(crate = "near_sdk::borsh")]
pub struct Vault {
    available: u128,
    pending: u128,
    storage_paid: u128,
    agent: Option<AccountId>,
    agent_expiry: u64,
    max_payment: u128,
    window_limit: u128,
    approval_threshold: u128,
    window_ns: u64,
    window_id: u64,
    spent: u128,
    reserved: u128,
    policy_version: u64,
    recipients: BTreeSet<AccountId>,
    payments: BTreeMap<String, Payment>,
    withdrawal_nonce: u64,
    withdrawals: BTreeMap<u64, u128>,
}

#[derive(BorshDeserialize, BorshSerialize, Clone)]
#[borsh(crate = "near_sdk::borsh")]
pub struct Payment {
    recipient: AccountId,
    amount: u128,
    policy_version: u64,
    status: u8, // 0 ready, 1 awaiting approval, 2 approved, 3 pending, 4 settled, 5 failed
    window_id: u64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    admin: AccountId,
    vaults: LookupMap<AccountId, Vault>,
    vault_count: u64,
    total_available: u128,
}

#[near]
impl Contract {
    #[init]
    pub fn new() -> Self {
        require!(env::predecessor_account_id() == env::current_account_id(), "SELF_INIT_ONLY");
        Self { admin: env::current_account_id(), vaults: LookupMap::new(b"v"),
            vault_count: 0, total_available: 0 }
    }

    /// Deposit is reserved for this owner's storage; it is never counted as spendable.
    #[payable]
    pub fn create_vault(&mut self, max_payment: U128, window_limit: U128,
                        approval_threshold: U128, window_ns: u64) {
        let owner = env::predecessor_account_id();
        require!(owner != env::current_account_id(), "OWNER_MUST_BE_EXTERNAL");
        require!(!self.vaults.contains_key(&owner), "VAULT_EXISTS");
        require!(max_payment.0 > 0 && window_limit.0 >= max_payment.0 &&
                 approval_threshold.0 <= max_payment.0 && window_ns > 0, "INVALID_LIMITS");
        let deposit = env::attached_deposit().as_yoctonear();
        require!(deposit >= MIN_STORAGE_DEPOSIT, "INSUFFICIENT_STORAGE_DEPOSIT");
        self.vaults.insert(owner, Vault {
            available: 0, pending: 0, storage_paid: deposit, agent: None, agent_expiry: 0,
            max_payment: max_payment.0, window_limit: window_limit.0,
            approval_threshold: approval_threshold.0, window_ns, window_id: 0,
            spent: 0, reserved: 0, policy_version: 1,
            recipients: BTreeSet::new(), payments: BTreeMap::new(),
            withdrawal_nonce: 0, withdrawals: BTreeMap::new(),
        });
        self.vault_count = self.vault_count.checked_add(1).expect("OVERFLOW");
        let owner = env::predecessor_account_id();
        self.assert_storage(&owner);
        self.assert_solvency();
    }

    #[payable]
    pub fn deposit(&mut self) {
        let owner = env::predecessor_account_id();
        let amount = env::attached_deposit().as_yoctonear();
        require!(amount > 0, "ZERO_DEPOSIT");
        let vault = self.vaults.get_mut(&owner).expect("VAULT_MISSING");
        vault.available = vault.available.checked_add(amount).expect("OVERFLOW");
        self.total_available = self.total_available.checked_add(amount).expect("OVERFLOW");
        self.assert_solvency();
    }

    #[payable]
    pub fn top_up_storage(&mut self) {
        let owner = env::predecessor_account_id();
        let amount = env::attached_deposit().as_yoctonear();
        require!(amount > 0, "ZERO_DEPOSIT");
        let v = self.vaults.get_mut(&owner).expect("VAULT_MISSING");
        v.storage_paid = v.storage_paid.checked_add(amount).expect("OVERFLOW");
        self.assert_solvency();
    }

    pub fn get_vault(&self, owner: AccountId) -> Option<(U128, U128, U128, Option<AccountId>, U64, u64)> {
        self.vaults.get(&owner).map(|v| (U128(v.available), U128(v.pending),
            U128(v.storage_paid), v.agent.clone(), U64(v.agent_expiry), v.policy_version))
    }

    pub fn get_payment(&self, owner: AccountId, id: String) -> Option<(u8, U128)> {
        self.vaults.get(&owner)?.payments.get(&id).map(|p| (p.status, U128(p.amount)))
    }

    /// Read-only reconciliation data. Status 3 remains locked until the actual
    /// callback succeeds; elapsed time never proves whether the transfer ran.
    pub fn get_payment_details(&self, owner: AccountId, id: String)
        -> Option<(u8, U128, AccountId, u64, u64)> {
        let p = self.vaults.get(&owner)?.payments.get(&id)?;
        Some((p.status, U128(p.amount), p.recipient.clone(), p.policy_version, p.window_id))
    }

    pub fn get_pending_withdrawal(&self, owner: AccountId, nonce: u64) -> Option<U128> {
        self.vaults.get(&owner)?.withdrawals.get(&nonce).copied().map(U128)
    }

    pub fn set_agent(&mut self, agent: Option<AccountId>, expires_at_ns: U64) {
        let owner = env::predecessor_account_id();
        if let Some(ref id) = agent {
            require!(id != &owner && id != &env::current_account_id(), "INVALID_AGENT");
            let now = env::block_timestamp();
            require!(expires_at_ns.0 > now && expires_at_ns.0 <= now.saturating_add(MAX_GRANT_NS), "INVALID_EXPIRY");
        } else { require!(expires_at_ns.0 == 0, "INVALID_EXPIRY"); }
        let v = self.vaults.get_mut(&owner).expect("VAULT_MISSING");
        v.agent = agent;
        v.agent_expiry = expires_at_ns.0;
        v.policy_version = v.policy_version.checked_add(1).expect("OVERFLOW");
        self.assert_storage(&owner);
        self.assert_solvency();
    }

    pub fn set_recipient(&mut self, recipient: AccountId, allowed: bool) {
        require!(recipient != env::current_account_id(), "SELF_PAYMENT");
        let owner = env::predecessor_account_id();
        let v = self.vaults.get_mut(&owner).expect("VAULT_MISSING");
        require!(v.recipients.len() < 32 || !allowed || v.recipients.contains(&recipient), "ALLOWLIST_FULL");
        if allowed { v.recipients.insert(recipient); } else { v.recipients.remove(&recipient); }
        v.policy_version = v.policy_version.checked_add(1).expect("OVERFLOW");
        self.assert_storage(&owner);
        self.assert_solvency();
    }

    pub fn request_payment(&mut self, owner: AccountId, id: String, recipient: AccountId,
                           amount: U128, policy_version: u64) -> u8 {
        let v = self.vaults.get_mut(&owner).expect("VAULT_MISSING");
        require!(v.agent.as_ref() == Some(&env::predecessor_account_id()) &&
                 env::block_timestamp() < v.agent_expiry, "AGENT_UNAUTHORIZED");
        require!(!id.is_empty() && id.len() <= 64 && id.bytes().all(|b| (0x21..=0x7e).contains(&b)), "INVALID_ID");
        require!(v.payments.len() < MAX_RECORDS && !v.payments.contains_key(&id), "DUPLICATE_OR_FULL");
        require!(v.policy_version == policy_version, "STALE_POLICY");
        require!(v.recipients.contains(&recipient), "RECIPIENT_DENIED");
        require!(amount.0 > 0 && amount.0 <= v.max_payment, "PAYMENT_LIMIT");
        let status = if amount.0 > v.approval_threshold { 1 } else { 0 };
        v.payments.insert(id, Payment { recipient, amount: amount.0, policy_version,
            status, window_id: 0 });
        self.assert_storage(&owner);
        self.assert_solvency();
        status
    }

    pub fn approve_payment(&mut self, id: String) {
        let v = self.vaults.get_mut(&env::predecessor_account_id()).expect("VAULT_MISSING");
        let p = v.payments.get_mut(&id).expect("PAYMENT_MISSING");
        require!(p.status == 1 && p.policy_version == v.policy_version, "NOT_APPROVABLE");
        p.status = 2;
        self.assert_solvency();
    }

    pub fn execute_payment(&mut self, owner: AccountId, id: String) -> Promise {
        let v = self.vaults.get_mut(&owner).expect("VAULT_MISSING");
        require!(v.agent.as_ref() == Some(&env::predecessor_account_id()) &&
                 env::block_timestamp() < v.agent_expiry, "AGENT_UNAUTHORIZED");
        let p = v.payments.get(&id).expect("PAYMENT_MISSING").clone();
        require!(p.status == 0 || p.status == 2, "NOT_EXECUTABLE");
        require!(p.policy_version == v.policy_version && v.recipients.contains(&p.recipient), "STALE_POLICY");
        require!(p.amount <= v.max_payment && (p.amount <= v.approval_threshold || p.status == 2), "PAYMENT_LIMIT");
        let window = env::block_timestamp() / v.window_ns;
        if v.window_id != window { v.window_id = window; v.spent = 0; v.reserved = 0; }
        require!(v.spent.checked_add(v.reserved).and_then(|x| x.checked_add(p.amount))
            .is_some_and(|sum| sum <= v.window_limit), "WINDOW_LIMIT");
        require!(v.available >= p.amount, "INSUFFICIENT_VAULT_BALANCE");
        v.available -= p.amount;
        self.total_available = self.total_available.checked_sub(p.amount).expect("OVERFLOW");
        v.pending = v.pending.checked_add(p.amount).expect("OVERFLOW");
        v.reserved = v.reserved.checked_add(p.amount).expect("OVERFLOW");
        let entry = v.payments.get_mut(&id).expect("PAYMENT_MISSING");
        entry.status = 3;
        entry.window_id = window;
        self.assert_solvency_with_outgoing(p.amount);
        env::log_str(&format!("PAYMENT_TRANSFER owner={owner} id={id} recipient={} amount={}", p.recipient, p.amount));
        Promise::new(p.recipient).transfer(NearToken::from_yoctonear(p.amount))
            .then(Self::ext(env::current_account_id()).with_static_gas(CALLBACK_GAS).on_transfer(owner, id))
    }

    #[private]
    pub fn on_transfer(&mut self, owner: AccountId, id: String,
                       #[callback_result] result: Result<(), PromiseError>) -> u8 {
        #[cfg(feature = "fault-callback")]
        env::panic_str("INJECTED_CALLBACK_FAILURE");
        let v = self.vaults.get_mut(&owner).expect("VAULT_MISSING");
        let p = v.payments.get(&id).expect("PAYMENT_MISSING").clone();
        require!(p.status == 3 && v.pending >= p.amount, "ALREADY_FINALIZED");
        v.pending -= p.amount;
        if result.is_err() {
            v.available = v.available.checked_add(p.amount).expect("OVERFLOW");
            self.total_available = self.total_available.checked_add(p.amount).expect("OVERFLOW");
        }
        // Window may have rolled while promise was pending. The old payment still
        // reserves global funds; its old window no longer affects current budget.
        if p.window_id == v.window_id {
            v.reserved = v.reserved.checked_sub(p.amount).expect("RESERVATION_UNDERFLOW");
            if result.is_ok() { v.spent = v.spent.checked_add(p.amount).expect("OVERFLOW"); }
        }
        let status = if result.is_ok() { 4 } else { 5 };
        v.payments.get_mut(&id).expect("PAYMENT_MISSING").status = status;
        self.assert_solvency();
        env::log_str(&format!("PAYMENT_FINAL owner={owner} id={id} status={status}"));
        status
    }

    pub fn withdraw(&mut self, amount: U128) -> Promise {
        let owner = env::predecessor_account_id();
        let v = self.vaults.get_mut(&owner).expect("VAULT_MISSING");
        require!(amount.0 > 0 && v.available >= amount.0, "INSUFFICIENT_AVAILABLE");
        v.available -= amount.0;
        self.total_available = self.total_available.checked_sub(amount.0).expect("OVERFLOW");
        v.pending = v.pending.checked_add(amount.0).expect("OVERFLOW");
        require!(v.withdrawals.len() < MAX_RECORDS, "WITHDRAWAL_CAPACITY");
        let nonce = v.withdrawal_nonce.checked_add(1).expect("OVERFLOW");
        v.withdrawal_nonce = nonce;
        v.withdrawals.insert(nonce, amount.0);
        self.assert_storage(&owner);
        self.assert_solvency_with_outgoing(amount.0);
        env::log_str(&format!("WITHDRAW_TRANSFER owner={owner} nonce={nonce} amount={}", amount.0));
        Promise::new(owner.clone()).transfer(NearToken::from_yoctonear(amount.0))
            .then(Self::ext(env::current_account_id()).with_static_gas(CALLBACK_GAS).on_withdraw(owner, nonce))
    }

    #[private]
    pub fn on_withdraw(&mut self, owner: AccountId, nonce: u64,
                       #[callback_result] result: Result<(), PromiseError>) {
        #[cfg(feature = "fault-callback")]
        env::panic_str("INJECTED_CALLBACK_FAILURE");
        let v = self.vaults.get_mut(&owner).expect("VAULT_MISSING");
        let amount = *v.withdrawals.get(&nonce).expect("WITHDRAWAL_MISSING");
        require!(v.pending >= amount, "PENDING_MISSING");
        v.withdrawals.remove(&nonce);
        v.pending -= amount;
        if result.is_err() {
            v.available = v.available.checked_add(amount).expect("OVERFLOW");
            self.total_available = self.total_available.checked_add(amount).expect("OVERFLOW");
        }
        self.assert_solvency();
        env::log_str(&format!("WITHDRAW_FINAL owner={owner} nonce={nonce} success={}", result.is_ok()));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;
    fn a(s: &str) -> AccountId { s.parse().unwrap() }
    fn ctx(who: &str, deposit: u128, time: u64) {
        let mut b = VMContextBuilder::new();
        b.current_account_id(a("arena.testnet"))
            .predecessor_account_id(a(who))
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .account_balance(NearToken::from_near(10))
            .block_timestamp(time);
        testing_env!(b.build());
    }
    fn setup() -> Contract {
        ctx("arena.testnet", 0, 1);
        let mut c = Contract::new();
        for owner in ["a.testnet", "b.testnet"] {
            ctx(owner, NearToken::from_millinear(100).as_yoctonear(), 1);
            c.create_vault(U128(50), U128(60), U128(25), 100);
            ctx(owner, 100, 1); c.deposit();
            ctx(owner, 0, 1);
            c.set_agent(Some(a(if owner == "a.testnet" { "agent.testnet" } else { "agent-b.testnet" })), U64(1000));
            c.set_recipient(a("vendor.testnet"), true);
        }
        c
    }
    fn denied(f: impl FnOnce()) { assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)).is_err()); }
    fn request(c: &mut Contract, owner: &str, id: &str, amount: u128) -> u8 {
        ctx("agent.testnet", 0, 1);
        let version = c.vaults.get(&a(owner)).unwrap().policy_version;
        c.request_payment(a(owner), id.into(), a("vendor.testnet"), U128(amount), version)
    }
    #[test] fn create_a_and_b_isolated() {
        let c = setup();
        assert_eq!(c.vault_count, 2);
        assert_eq!(c.total_available, 200);
        assert_eq!(c.vaults[&a("a.testnet")].available, 100);
        assert_eq!(c.vaults[&a("b.testnet")].available, 100);
    }
    #[test] fn duplicate_create_denied() {
        let mut c = setup(); ctx("a.testnet", NearToken::from_millinear(100).as_yoctonear(), 1);
        denied(|| c.create_vault(U128(50), U128(60), U128(25), 100));
    }
    #[test] fn a_cannot_change_b() {
        let mut c = setup(); ctx("a.testnet", 0, 1); c.set_agent(None, U64(0));
        assert!(c.vaults[&a("b.testnet")].agent.is_some());
        denied(|| c.approve_payment("b-id".into()));
    }
    #[test] fn no_agent_permission_denied() {
        let mut c = setup(); ctx("stranger.testnet", 0, 1);
        let version = c.vaults[&a("a.testnet")].policy_version;
        denied(|| { c.request_payment(a("a.testnet"), "x".into(), a("vendor.testnet"), U128(10), version); });
    }
    #[test] fn agent_a_cannot_spend_b() {
        let mut c = setup(); ctx("agent.testnet", 0, 1);
        let version = c.vaults[&a("b.testnet")].policy_version;
        denied(|| { c.request_payment(a("b.testnet"), "x".into(), a("vendor.testnet"), U128(10), version); });
        assert_eq!(c.vaults[&a("b.testnet")].available, 100);
    }
    #[test] fn empty_allowlist_denies_all() {
        let mut c = setup(); ctx("a.testnet", 0, 1); c.set_recipient(a("vendor.testnet"), false);
        ctx("agent.testnet", 0, 1); let version = c.vaults[&a("a.testnet")].policy_version;
        denied(|| { c.request_payment(a("a.testnet"), "x".into(), a("vendor.testnet"), U128(10), version); });
    }
    #[test] fn allowed_payment_and_isolation() {
        let mut c = setup(); assert_eq!(request(&mut c, "a.testnet", "p", 10), 0);
        ctx("agent.testnet", 0, 1); let _ = c.execute_payment(a("a.testnet"), "p".into());
        assert_eq!(c.vaults[&a("a.testnet")].available, 90);
        assert_eq!(c.vaults[&a("a.testnet")].pending, 10);
        assert_eq!(c.vaults[&a("b.testnet")].available, 100);
        ctx("arena.testnet", 0, 1); assert_eq!(c.on_transfer(a("a.testnet"), "p".into(), Ok(())), 4);
    }
    #[test] fn payment_limit_denied() {
        let mut c = setup(); ctx("agent.testnet", 0, 1); let version = c.vaults[&a("a.testnet")].policy_version;
        denied(|| { c.request_payment(a("a.testnet"), "x".into(), a("vendor.testnet"), U128(51), version); });
    }
    #[test] fn recipient_outside_allowlist_denied() {
        let mut c = setup(); ctx("agent.testnet", 0, 1); let version = c.vaults[&a("a.testnet")].policy_version;
        denied(|| { c.request_payment(a("a.testnet"), "x".into(), a("other.testnet"), U128(10), version); });
    }
    #[test] fn duplicate_request_id_denied() {
        let mut c = setup(); request(&mut c, "a.testnet", "p", 10);
        ctx("agent.testnet", 0, 1); let version = c.vaults[&a("a.testnet")].policy_version;
        denied(|| { c.request_payment(a("a.testnet"), "p".into(), a("vendor.testnet"), U128(10), version); });
    }
    #[test] fn revoked_agent_denied() {
        let mut c = setup(); ctx("a.testnet", 0, 1); c.set_agent(None, U64(0));
        ctx("agent.testnet", 0, 1); let version = c.vaults[&a("a.testnet")].policy_version;
        denied(|| { c.request_payment(a("a.testnet"), "x".into(), a("vendor.testnet"), U128(10), version); });
    }
    #[test] fn expired_agent_denied() {
        let mut c = setup(); ctx("agent.testnet", 0, 1000);
        let version = c.vaults[&a("a.testnet")].policy_version;
        denied(|| { c.request_payment(a("a.testnet"), "x".into(), a("vendor.testnet"), U128(10), version); });
    }
    #[test] fn pending_approval_does_not_bypass_window() {
        let mut c = setup(); request(&mut c, "a.testnet", "p1", 40); request(&mut c, "a.testnet", "p2", 40);
        ctx("a.testnet", 0, 1); c.approve_payment("p1".into()); c.approve_payment("p2".into());
        ctx("agent.testnet", 0, 1); let _ = c.execute_payment(a("a.testnet"), "p1".into());
        denied(|| { let _ = c.execute_payment(a("a.testnet"), "p2".into()); });
    }
    #[test] fn failed_transfer_restores_exactly_once() {
        let mut c = setup(); request(&mut c, "a.testnet", "p", 10);
        ctx("agent.testnet", 0, 1); let _ = c.execute_payment(a("a.testnet"), "p".into());
        ctx("arena.testnet", 0, 1); assert_eq!(c.on_transfer(a("a.testnet"), "p".into(), Err(PromiseError::Failed)), 5);
        assert_eq!(c.vaults[&a("a.testnet")].available, 100);
        assert_eq!(c.vaults[&a("a.testnet")].pending, 0);
        denied(|| { c.on_transfer(a("a.testnet"), "p".into(), Err(PromiseError::Failed)); });
    }
    #[test] fn settled_transfer_cannot_double_debit() {
        let mut c = setup(); request(&mut c, "a.testnet", "p", 10);
        ctx("agent.testnet", 0, 1); let _ = c.execute_payment(a("a.testnet"), "p".into());
        ctx("arena.testnet", 0, 1); c.on_transfer(a("a.testnet"), "p".into(), Ok(()));
        denied(|| { c.on_transfer(a("a.testnet"), "p".into(), Ok(())); });
        assert_eq!(c.vaults[&a("a.testnet")].available, 90);
    }
    #[test] fn failed_transfer_retry_needs_fresh_id_and_restores_limit() {
        let mut c = setup(); request(&mut c, "a.testnet", "failed", 10);
        ctx("agent.testnet", 0, 1); let _ = c.execute_payment(a("a.testnet"), "failed".into());
        ctx("arena.testnet", 0, 1); c.on_transfer(a("a.testnet"), "failed".into(), Err(PromiseError::Failed));
        ctx("agent.testnet", 0, 1);
        denied(|| { let _ = c.execute_payment(a("a.testnet"), "failed".into()); });
        assert_eq!(request(&mut c, "a.testnet", "retry", 10), 0);
        let _ = c.execute_payment(a("a.testnet"), "retry".into());
        assert_eq!(c.vaults[&a("a.testnet")].available, 90);
        assert_eq!(c.vaults[&a("a.testnet")].pending, 10);
    }
    #[test] fn borsh_state_roundtrip_and_lookup_map() {
        let mut c = setup(); request(&mut c, "a.testnet", "p", 10);
        let bytes = near_sdk::borsh::to_vec(&c).unwrap();
        let restored = Contract::try_from_slice(&bytes).unwrap();
        assert_eq!(restored.vaults[&a("a.testnet")].payments.len(), 1);
        assert_eq!(restored.vaults[&a("b.testnet")].available, 100);
        assert_eq!(restored.total_available, 200);
    }
    #[test] fn projected_storage_growth_requires_contract_balance() {
        let mut c = setup();
        let mut b = VMContextBuilder::new();
        b.current_account_id(a("arena.testnet"))
            .predecessor_account_id(a("agent.testnet"))
            .account_balance(NearToken::from_yoctonear(MIN_BUFFER + 200))
            .block_timestamp(1);
        testing_env!(b.build());
        let version = c.vaults[&a("a.testnet")].policy_version;
        denied(|| { c.request_payment(a("a.testnet"), "new-storage".into(),
            a("vendor.testnet"), U128(10), version); });
    }
    #[test] fn checked_deposit_overflow_rejected() {
        let mut c = setup();
        c.vaults.get_mut(&a("a.testnet")).unwrap().available = u128::MAX;
        ctx("a.testnet", 1, 1);
        denied(|| c.deposit());
    }
    #[test] fn owner_withdraw_and_replay_denied() {
        let mut c = setup(); ctx("a.testnet", 0, 1); let _ = c.withdraw(U128(40));
        assert_eq!(c.vaults[&a("a.testnet")].available, 60);
        ctx("arena.testnet", 0, 1); c.on_withdraw(a("a.testnet"), 1, Ok(()));
        denied(|| { c.on_withdraw(a("a.testnet"), 1, Ok(())); });
    }
    #[test] fn failed_withdraw_restores_once_and_capacity_recovers() {
        let mut c = setup();
        for nonce in 1..=65 {
            ctx("a.testnet", 0, 1); let _ = c.withdraw(U128(1));
            ctx("arena.testnet", 0, 1);
            c.on_withdraw(a("a.testnet"), nonce, Err(PromiseError::Failed));
        }
        assert_eq!(c.vaults[&a("a.testnet")].available, 100);
        assert_eq!(c.vaults[&a("a.testnet")].pending, 0);
        assert!(c.vaults[&a("a.testnet")].withdrawals.is_empty());
        denied(|| { c.on_withdraw(a("a.testnet"), 65, Err(PromiseError::Failed)); });
    }
    #[test] fn pending_funds_cannot_be_withdrawn() {
        let mut c = setup(); request(&mut c, "a.testnet", "p", 10);
        ctx("agent.testnet", 0, 1); let _ = c.execute_payment(a("a.testnet"), "p".into());
        ctx("a.testnet", 0, 1); denied(|| { let _ = c.withdraw(U128(100)); });
    }
    #[test] fn insufficient_storage_deposit_denied() {
        ctx("arena.testnet", 0, 1); let mut c = Contract::new();
        ctx("a.testnet", 1, 1); denied(|| c.create_vault(U128(50), U128(60), U128(25), 100));
    }
    #[test] fn external_initializer_denied() {
        ctx("stranger.testnet", 0, 1); denied(|| { Contract::new(); });
    }
}

impl Contract {
    fn assert_storage(&self, owner: &AccountId) {
        let v = self.vaults.get(owner).expect("VAULT_MISSING");
        // Covers the serialized vault, owner key and a conservative entry overhead.
        // Sandbox storage usage remains the authoritative deployment check.
        let bytes = near_sdk::borsh::to_vec(v).expect("SERIALIZE").len()
            + owner.as_str().len() + 128;
        require!(v.storage_paid >= (bytes as u128).saturating_mul(env::storage_byte_cost().as_yoctonear()),
                 "INSUFFICIENT_STORAGE_DEPOSIT");
    }
    fn assert_solvency(&mut self) {
        self.finalize_accounting(0);
    }

    fn assert_solvency_with_outgoing(&mut self, outgoing: u128) {
        self.finalize_accounting(outgoing);
    }

    fn finalize_accounting(&mut self, outgoing: u128) {
        self.vaults.flush();
        let floor = u128::from(env::storage_usage()).checked_mul(env::storage_byte_cost().as_yoctonear()).expect("OVERFLOW");
        require!(env::account_balance().as_yoctonear() >= self.total_available.checked_add(outgoing)
            .and_then(|x| x.checked_add(floor)).and_then(|x| x.checked_add(MIN_BUFFER))
            .expect("OVERFLOW"), "INSOLVENT_OUTGOING");
    }
}
