import type { CeloAccount, Transaction } from "./types";
import { celoKit } from "./api/sdk";
import { BigNumber } from "bignumber.js";
import { getPendingStakingOperationAmounts, getVote } from "./logic";
import type { CeloTx } from "./api/sdk";
import type ethers from "ethers";

const buildTransaction = async (
  account: CeloAccount,
  transaction: Transaction,
): Promise<CeloTx> => {
  const kit = celoKit();

  const value = transactionValue(account, transaction);

  let celoTransaction: Omit<CeloTx, "gas"> & { gas: ethers.BigNumber };

  if (transaction.mode === "lock") {
    const lockedGold = await kit.contracts.getLockedGold();
    const data = lockedGold.interface.encodeFunctionData("lock");
    const gas = await lockedGold.estimateGas.lock({ from: account.freshAddress, value });

    celoTransaction = {
      from: account.freshAddress,
      to: lockedGold.address,
      value: value.toString(10),
      data,
      gas,
    };
  } else if (transaction.mode === "unlock") {
    const lockedGold = await kit.contracts.getLockedGold();
    const data = lockedGold.interface.encodeFunctionData("unlock", [value]);
    const gas = await lockedGold.estimateGas.unlock(value, { from: account.freshAddress });

    celoTransaction = {
      from: account.freshAddress,
      to: lockedGold.address,
      data,
      gas,
    };
  } else if (transaction.mode === "withdraw") {
    const lockedGold = await kit.contracts.getLockedGold();
    const data = lockedGold.interface.encodeFunctionData("withdraw", [transaction.index || 0]);
    const gas = await lockedGold.estimateGas.withdraw(transaction.index || 0, {
      from: account.freshAddress,
    });

    celoTransaction = {
      from: account.freshAddress,
      to: lockedGold.address,
      data,
      gas,
    };
  } else if (transaction.mode === "vote") {
    const election = await kit.contracts.getElection();
    const data = election.interface.encodeFunctionData("vote", [
      transaction.recipient,
      new BigNumber(value),
    ]);
    const gas = await election.estimateGas.vote(transaction.recipient, new BigNumber(value), {
      from: account.freshAddress,
    });

    celoTransaction = {
      from: account.freshAddress,
      to: election.address,
      data,
      gas,
    };
  } else if (transaction.mode === "revoke") {
    const election = await kit.contracts.getElection();
    const accounts = await kit.contracts.getAccounts();
    const voteSignerAccount = await accounts.voteSignerToAccount(account.freshAddress);

    const revokes = await election.revoke(
      voteSignerAccount,
      transaction.recipient,
      new BigNumber(value),
    );
    const revoke = revokes.find(transactionObject => {
      return (
        transactionObject.method === (transaction.index === 0 ? "revokePending" : "revokeActive")
      );
    });
    if (!revoke) throw new Error("No votes to revoke");

    const data = revoke.data;
    const gas = await kit.provider.estimateGas({
      from: account.freshAddress,
      data,
      to: election.address,
    });

    celoTransaction = {
      from: account.freshAddress,
      to: election.address,
      data,
      gas,
    };
  } else if (transaction.mode === "activate") {
    const election = await kit.contracts.getElection();
    const accounts = await kit.contracts.getAccounts();
    const voteSignerAccount = await accounts.voteSignerToAccount(account.freshAddress);

    const activates = await election.activate(voteSignerAccount);
    const activate = activates.find(a => a.args[0] === transaction.recipient);
    if (!activate) throw new Error("No votes to activate");

    const data = activate.data;
    const gas = await kit.provider.estimateGas({
      from: account.freshAddress,
      to: election.address,
      data,
    });

    celoTransaction = {
      from: account.freshAddress,
      to: election.address,
      data,
      gas,
    };
  } else if (transaction.mode === "register") {
    const accounts = await kit.contracts.getAccounts();
    const data = accounts.interface.encodeFunctionData("createAccount");
    const gas = await accounts.estimateGas.createAccount({ from: account.freshAddress });

    celoTransaction = {
      from: account.freshAddress,
      to: accounts.address,
      data,
      gas,
    };
  } else {
    // Send
    const celoToken = await kit.contracts.getCeloToken();
    const data = celoToken.interface.encodeFunctionData("transfer", [
      transaction.recipient,
      value.toFixed(),
    ]);
    const gas = await celoToken.estimateGas.transfer(transaction.recipient, value.toFixed(), {
      from: account.freshAddress,
    });

    celoTransaction = {
      from: account.freshAddress,
      to: celoToken.address,
      data,
      gas,
    };
  }

  const tx: CeloTx = {
    ...celoTransaction,
    chainId: kit.provider.network.chainId,
    nonce: await kit.provider.getTransactionCount(account.freshAddress),
    gas: celoTransaction.gas?.toString(),
  };

  return {
    ...tx,
    ...(await kit.getFeeData(tx)),
  };
};

const transactionValue = (account: CeloAccount, transaction: Transaction): BigNumber => {
  let value = transaction.amount;

  if (transaction.useAllAmount) {
    if ((transaction.mode === "unlock" || transaction.mode === "vote") && account.celoResources) {
      const pendingOperationAmounts = getPendingStakingOperationAmounts(account);
      const pendingOperationAmount =
        transaction.mode === "vote" ? pendingOperationAmounts.vote : new BigNumber(0);
      value = account.celoResources.nonvotingLockedBalance.minus(pendingOperationAmount);
    } else if (transaction.mode === "revoke" && account.celoResources) {
      const revoke = getVote(account, transaction.recipient, transaction.index);
      if (revoke?.amount) value = revoke.amount;
    } else {
      value = account.spendableBalance.minus(transaction.fees || 0);
    }
  }

  return value;
};

export default buildTransaction;
