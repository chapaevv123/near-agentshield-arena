use std::collections::{BTreeMap, BTreeSet};
use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::json_types::{U128, U64};
use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError};

// Isolated sandbox-only snapshot of Vault v2. The Borsh structs and map prefix
// below must remain byte-for-byte equivalent to the normal contract's layout.
#[cfg(all(feature = "recover-success", feature = "recover-failure"))]
compile_error!("choose exactly one recovery outcome");
#[cfg(not(any(feature = "recover-success", feature = "recover-failure")))]
compile_error!("a fixed recovery outcome is required");
#[cfg(any(
    all(feature = "wrong-owner", feature = "wrong-amount"),
    all(feature = "wrong-owner", feature = "wrong-id"),
    all(feature = "wrong-amount", feature = "wrong-id")
))]
compile_error!("choose at most one invalid-manifest fixture");

const CASE_AMOUNT: u128 = if cfg!(feature = "wrong-amount") {
    200_000_000_000_000_000_000_000
} else {
    100_000_000_000_000_000_000_000
};
const CASE_CONTRACT: &str = "arena.test.near";
const CASE_OWNER: &str = if cfg!(feature = "wrong-owner") {
    "other.test.near"
} else {
    "owner.test.near"
};
const CASE_ID: &str = if cfg!(feature = "wrong-id") {
    "wrong-request-id"
} else if cfg!(feature = "recover-success") {
    "recover-success"
} else {
    "recover-failure"
};
const CASE_RECIPIENT: &str = if cfg!(feature = "recover-success") {
    "vendor.test.near"
} else {
    "absent-recovery.test.near"
};
const CASE_POLICY_VERSION: u64 = 4; // set_agent + two set_recipient calls

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
        require!(false, "RECOVERY_BUILD_CANNOT_INIT");
        require!(env::predecessor_account_id() == env::current_account_id(), "SELF_INIT_ONLY");
        Self { admin: env::current_account_id(), vaults: LookupMap::new(b"v"),
            vault_count: 0, total_available: 0 }
    }

    /// Deposit is reserved for this owner's storage; it is never counted as spendable.
    #[payable]
    pub fn create_vault(&mut self, max_payment: U128, window_limit: U128,
                        approval_threshold: U128, window_ns: u64) {
        require!(false, "RECOVERY_FREEZE");
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
        require!(false, "RECOVERY_FREEZE");
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
        require!(false, "RECOVERY_FREEZE");
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
        require!(false, "RECOVERY_FREEZE");
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
        require!(false, "RECOVERY_FREEZE");
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
        require!(false, "RECOVERY_FREEZE");
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
        require!(false, "RECOVERY_FREEZE");
        let v = self.vaults.get_mut(&env::predecessor_account_id()).expect("VAULT_MISSING");
        let p = v.payments.get_mut(&id).expect("PAYMENT_MISSING");
        require!(p.status == 1 && p.policy_version == v.policy_version, "NOT_APPROVABLE");
        p.status = 2;
        self.assert_solvency();
    }

    pub fn execute_payment(&mut self, owner: AccountId, id: String) -> Promise {
        require!(false, "RECOVERY_FREEZE");
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
        require!(false, "RECOVERY_FREEZE");
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

    /// No arguments: this binary contains one fixed sandbox operation and outcome.
    /// Historical receipt verification is deliberately external to the contract.
    pub fn recover_case(&mut self) -> u8 {
        require!(env::current_account_id().as_str() == CASE_CONTRACT, "CASE_CONTRACT_MISMATCH");
        require!(env::predecessor_account_id() == env::current_account_id(), "SELF_ONLY");
        let owner: AccountId = CASE_OWNER.parse().expect("CASE_OWNER");
        let recipient: AccountId = CASE_RECIPIENT.parse().expect("CASE_RECIPIENT");
        let v = self.vaults.get_mut(&owner).expect("CASE_VAULT_MISSING");
        let p = v.payments.get(CASE_ID).expect("CASE_PAYMENT_MISSING").clone();
        require!(p.status == 3 && p.amount == CASE_AMOUNT && p.recipient == recipient &&
            p.policy_version == CASE_POLICY_VERSION && v.pending >= CASE_AMOUNT,
            "CASE_MISMATCH");
        v.pending = v.pending.checked_sub(CASE_AMOUNT).expect("PENDING_UNDERFLOW");
        let success = cfg!(feature = "recover-success");
        if !success {
            v.available = v.available.checked_add(CASE_AMOUNT).expect("OVERFLOW");
            self.total_available = self.total_available.checked_add(CASE_AMOUNT).expect("OVERFLOW");
        }
        if p.window_id == v.window_id {
            v.reserved = v.reserved.checked_sub(CASE_AMOUNT).expect("RESERVATION_UNDERFLOW");
            if success { v.spent = v.spent.checked_add(CASE_AMOUNT).expect("OVERFLOW"); }
        }
        let status = if success { 4 } else { 5 };
        v.payments.get_mut(CASE_ID).expect("CASE_PAYMENT_MISSING").status = status;
        self.assert_solvency();
        env::log_str(&format!("SANDBOX_RECOVERY owner={owner} id={CASE_ID} amount={CASE_AMOUNT} status={status}"));
        status
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
