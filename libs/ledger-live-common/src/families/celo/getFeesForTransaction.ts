import { BigNumber } from "bignumber.js";
import type { CeloAccount, Transaction } from "./types";
import { celoKit } from "./api/sdk";
import { getPendingStakingOperationAmounts, getVote } from "./logic";
import { ethers } from "ethers";

const getFeesForTransaction = async ({
  account,
  transaction,
}: {
  account: CeloAccount;
  transaction: Transaction;
}): Promise<BigNumber> => {
  const { amount, index } = transaction;
  const kit = celoKit();

  // A workaround - estimating gas throws an error if value > funds
  let value: BigNumber = new BigNumber(0);

  const pendingOperationAmounts = getPendingStakingOperationAmounts(account);
  const lockedGold = await kit.contracts.getLockedGold();
  const nonvotingLockedGoldBalance = await lockedGold.getAccountNonvotingLockedGold(
    account.freshAddress,
  );
  // Deduct pending vote operations from the non-voting locked balance
  const totalNonVotingLockedBalance = nonvotingLockedGoldBalance.minus(
    pendingOperationAmounts.vote,
  );
  // Deduct pending lock operations from the spendable balance
  const totalSpendableBalance = account.spendableBalance.minus(pendingOperationAmounts.lock);

  if ((transaction.mode === "unlock" || transaction.mode === "vote") && account.celoResources) {
    value = transaction.useAllAmount
      ? totalNonVotingLockedBalance
      : BigNumber.minimum(amount, totalNonVotingLockedBalance);
  } else if (transaction.mode === "revoke" && account.celoResources) {
    const vote = getVote(account, transaction.recipient, transaction.index);
    if (vote) {
      value = transaction.useAllAmount ? vote.amount : BigNumber.minimum(amount, vote.amount);
    }
  } else {
    value = transaction.useAllAmount
      ? totalSpendableBalance
      : BigNumber.minimum(amount, totalSpendableBalance);
  }

  // ethers contracts return an ethers.BigNumber, not a bignumber.js BigNumber. but this is just an internal value.
  let gas: ethers.BigNumber | null = null;
  if (transaction.mode === "lock") {
    gas = await lockedGold.estimateGas.lock({
      from: account.freshAddress,
      value: value.toString(16),
    });
  } else if (transaction.mode === "unlock") {
    const lockedGold = await kit.contracts.getLockedGold();

    gas = await lockedGold.estimateGas.unlock(value, { from: account.freshAddress });
  } else if (transaction.mode === "withdraw") {
    const lockedGold = await kit.contracts.getLockedGold();

    gas = await lockedGold.estimateGas.withdraw(index || 0, { from: account.freshAddress });
  } else if (transaction.mode === "vote") {
    const election = await kit.contracts.getElection();

    gas = await election.estimateGas.vote(transaction.recipient, new BigNumber(value), {
      from: account.freshAddress,
    });
  } else if (transaction.mode === "revoke") {
    const election = await kit.contracts.getElection();
    const accounts = await kit.contracts.getAccounts();
    const voteSignerAccount = await accounts.voteSignerToAccount(account.freshAddress);
    // NOT  REAL METHOD
    const revokeTxs = await election.revoke(
      voteSignerAccount,
      transaction.recipient,
      new BigNumber(value),
    );

    const revokeTx = revokeTxs.find(transactionObject => {
      return (
        transactionObject.method === (transaction.index === 0 ? "revokePending" : "revokeActive")
      );
    });
    if (!revokeTx) return new BigNumber(0);

    gas = await kit.provider.estimateGas({ data: revokeTx.data, from: account.freshAddress });
  } else if (transaction.mode === "activate") {
    const election = await kit.contracts.getElection();
    const accounts = await kit.contracts.getAccounts();
    const voteSignerAccount = await accounts.voteSignerToAccount(account.freshAddress);

    const activates = await election.activate(voteSignerAccount);

    const activate = activates.find(a => a.args[0] === transaction.recipient);
    if (!activate) return new BigNumber(0);

    gas = await kit.provider.estimateGas({
      from: account.freshAddress,
      data: activate.data,
      to: election.address,
    });
  } else if (transaction.mode === "register") {
    const accounts = await kit.contracts.getAccounts();

    gas = await accounts.estimateGas.createAccount({ from: account.freshAddress });
  } else {
    const celoToken = await kit.contracts.getCeloToken();

    const celoTransaction = {
      from: account.freshAddress,
      to: celoToken.address,
      data: celoToken.interface.encodeFunctionData("transfer", [
        transaction.recipient,
        value.toFixed(),
      ]),
    };

    gas = await kit.provider.estimateGas(celoTransaction);
  }

  const gasPrice = new BigNumber((await kit.provider.getGasPrice()).toString());
  return gasPrice.times(gas?.toString() || 0);
};

export default getFeesForTransaction;
