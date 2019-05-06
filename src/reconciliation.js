// @flow
// libcore reconciliation by the React definition. https://reactjs.org/docs/reconciliation.html

import isEqual from "lodash/isEqual";
import { BigNumber } from "bignumber.js";
import type {
  Operation,
  OperationRaw,
  Account,
  AccountRaw,
  TokenAccount,
  TokenAccountRaw
} from "./types";
import {
  fromAccountRaw,
  fromOperationRaw,
  fromTokenAccountRaw
} from "./account";

const sameOp = (a: Operation, b: Operation) =>
  a === b ||
  (a.id === b.id && // hash, accountId, type are in id
    a.date.getTime() === b.date.getTime() &&
    (a.fee ? a.fee.isEqualTo(b.fee) : a.fee === b.fee) &&
    (a.value ? a.value.isEqualTo(b.value) : a.value === b.value) &&
    isEqual(a.senders, b.senders) &&
    isEqual(a.recipients, b.recipients));

function findExistingOp(ops, op) {
  return ops.find(o => o.id === op.id);
}

// aim to build operations with the minimal diff & call to libcore possible
export async function minimalOperationsBuilder<CO>(
  existingOperations: Operation[],
  coreOperations: CO[],
  buildOp: (coreOperation: CO) => Promise<?Operation>
): Promise<Operation[]> {
  if (existingOperations.length === 0 && coreOperations.length === 0) {
    return existingOperations;
  }
  let operations = [];
  let existingOps = existingOperations || [];

  let immutableOpCmpDoneOnce = false;
  for (let i = coreOperations.length - 1; i >= 0; i--) {
    const coreOperation = coreOperations[i];
    const newOp = await buildOp(coreOperation);
    if (!newOp) continue;
    const existingOp = findExistingOp(existingOps, newOp);

    if (existingOp && !immutableOpCmpDoneOnce) {
      // an Operation is supposely immutable.
      if (existingOp.blockHeight !== newOp.blockHeight) {
        // except for blockHeight that can temporarily be null
        operations.push(newOp);
        continue; // eslint-disable-line no-continue
      } else {
        immutableOpCmpDoneOnce = true;
        // we still check the first existing op we meet...
        if (!sameOp(existingOp, newOp)) {
          // this implement a failsafe in case an op changes (when we fix bugs)
          // tradeoff: in such case, we assume all existingOps are to trash
          console.warn("op mismatch. doing a full clear cache.");
          existingOps = [];
          operations.push(newOp);
          continue; // eslint-disable-line no-continue
        }
      }
    }

    if (existingOp) {
      // as soon as we've found a first matching op in old op list,
      const j = existingOps.indexOf(existingOp);
      const rest = existingOps.slice(j);
      if (rest.length !== i + 1) {
        // if libcore happen to have different number of ops that what we have,
        // we actualy need to continue because we don't know where hole will be,
        // but we can keep existingOp
        operations.push(existingOp);
      } else {
        // otherwise we stop the libcore iteration and continue with previous data
        // and we're done on the iteration
        if (operations.length === 0 && j === 0) {
          // special case: we preserve the operations array as much as possible
          operations = existingOps;
        } else {
          operations = operations.concat(rest);
        }
        break;
      }
    } else {
      // otherwise it's a new op
      operations.push(newOp);
    }
  }
  return operations;
}

// SYNC version of the same code...
export function minimalOperationsBuilderSync<CO>(
  existingOperations: Operation[],
  coreOperations: CO[],
  buildOp: (coreOperation: CO) => ?Operation
): Operation[] {
  if (existingOperations.length === 0 && coreOperations.length === 0) {
    return existingOperations;
  }
  let operations = [];
  let existingOps = existingOperations || [];
  let immutableOpCmpDoneOnce = false;
  for (let i = coreOperations.length - 1; i >= 0; i--) {
    const coreOperation = coreOperations[i];
    const newOp = buildOp(coreOperation);
    if (!newOp) continue;
    const existingOp = findExistingOp(existingOps, newOp);
    if (existingOp && !immutableOpCmpDoneOnce) {
      if (existingOp.blockHeight !== newOp.blockHeight) {
        operations.push(newOp);
        continue; // eslint-disable-line no-continue
      } else {
        immutableOpCmpDoneOnce = true;
        if (!sameOp(existingOp, newOp)) {
          console.warn("op mismatch. doing a full clear cache.");
          existingOps = [];
          operations.push(newOp);
          continue; // eslint-disable-line no-continue
        }
      }
    }
    if (existingOp) {
      const j = existingOps.indexOf(existingOp);
      const rest = existingOps.slice(j);
      if (rest.length !== i + 1) {
        operations.push(existingOp);
      } else {
        if (operations.length === 0 && j === 0) {
          operations = existingOps;
        } else {
          operations = operations.concat(rest);
        }
        break;
      }
    } else {
      operations.push(newOp);
    }
  }
  return operations;
}

export function patchAccount(
  account: Account,
  updatedRaw: AccountRaw
): Account {
  // id can change after a sync typically if changing the version or filling more info. in that case we consider all changes.
  if (account.id !== updatedRaw.id) return fromAccountRaw(updatedRaw);

  let tokenAccounts;
  if (updatedRaw.tokenAccounts) {
    const existingTokenAccounts = account.tokenAccounts || [];
    let tokenAccountsChanged =
      updatedRaw.tokenAccounts.length !== existingTokenAccounts.length;
    tokenAccounts = updatedRaw.tokenAccounts.map(ta => {
      const existing = existingTokenAccounts.find(t => t.id === ta.id);
      if (!existing) return fromTokenAccountRaw(ta);
      const patched = patchTokenAccount(existing, ta);
      if (patched !== existing) {
        tokenAccountsChanged = true;
      }
      return patched;
    });
    if (!tokenAccountsChanged) {
      tokenAccounts = existingTokenAccounts;
    }
  }

  const operations = patchOperations(
    account.operations,
    updatedRaw.operations,
    updatedRaw.id,
    tokenAccounts
  );

  const pendingOperations = patchOperations(
    account.pendingOperations,
    updatedRaw.pendingOperations,
    updatedRaw.id,
    tokenAccounts
  );

  const next: $Exact<Account> = {
    ...account
  };

  let changed = false;

  if (tokenAccounts && account.tokenAccounts !== tokenAccounts) {
    next.tokenAccounts = tokenAccounts;
    changed = true;
  }

  if (account.operations !== operations) {
    next.operations = operations;
    changed = true;
  }

  if (account.pendingOperations !== pendingOperations) {
    next.pendingOperations = pendingOperations;
    changed = true;
  }

  if (updatedRaw.balance !== account.balance.toString()) {
    next.balance = BigNumber(updatedRaw.balance);
    changed = true;
  }

  if (updatedRaw.lastSyncDate !== account.lastSyncDate.toISOString()) {
    next.lastSyncDate = new Date(updatedRaw.lastSyncDate);
    changed = true;
  }

  if (account.freshAddress !== updatedRaw.freshAddress) {
    next.freshAddress = updatedRaw.freshAddress;
    changed = true;
  }

  if (account.freshAddressPath !== updatedRaw.freshAddressPath) {
    next.freshAddressPath = updatedRaw.freshAddressPath;
    changed = true;
  }

  if (account.blockHeight !== updatedRaw.blockHeight) {
    next.blockHeight = updatedRaw.blockHeight;
    changed = true;
  }

  if (!changed) return account; // nothing changed at all

  return next;
}

export function patchTokenAccount(
  account: TokenAccount,
  updatedRaw: TokenAccountRaw
): TokenAccount {
  // id can change after a sync typically if changing the version or filling more info. in that case we consider all changes.
  if (account.id !== updatedRaw.id) return fromTokenAccountRaw(updatedRaw);

  const operations = patchOperations(
    account.operations,
    updatedRaw.operations,
    updatedRaw.id
  );

  const next: $Exact<TokenAccount> = {
    ...account
  };

  let changed = false;

  if (account.operations !== operations) {
    next.operations = operations;
    changed = true;
  }

  if (updatedRaw.balance !== account.balance.toString()) {
    next.balance = BigNumber(updatedRaw.balance);
    changed = true;
  }

  if (!changed) return account; // nothing changed at all

  return next;
}

export function patchOperations(
  operations: Operation[],
  updated: OperationRaw[],
  accountId: string,
  tokenAccounts: ?(TokenAccount[])
): Operation[] {
  return minimalOperationsBuilderSync(
    operations,
    updated.slice(0).reverse(),
    raw => fromOperationRaw(raw, accountId, tokenAccounts)
  );
}
