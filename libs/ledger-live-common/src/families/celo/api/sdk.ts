import { makeLRUCache } from "@ledgerhq/live-network/cache";
import { getEnv } from "@ledgerhq/live-env";
import { CeloVote } from "../types";
import { Contract, providers } from "ethers";
import { Election } from "./election";
import { accountsABI } from "./abis/accounts";
import { registryABI } from "./abis/registry";
import { lockedGoldABI } from "./abis/lockedGold";
import * as celoToken from "./abis/celoToken";

const REGISTRY_CONTRACT_ADDRESS = "0x000000000000000000000000000000000000ce10";

// a transaction compatible with Celo/wallet-ledger's LedgerWallet.rlpEncodedTxForLedger
export type CeloTx = {
  feeCurrency?: `0x${string}`;
  gas?: string;
  maxFeePerGas?: number;
  maxPriorityFeePerGas?: number;
  nonce?: number;
  value?: string;
  data?: string;
  to?: string;
  from?: string;
  chainId?: number;
};

export const celoKit = () => {
  const provider = new providers.StaticJsonRpcProvider(getEnv("API_CELO_NODE"));
  return {
    getFeeData: (transaction: CeloTx) => getFeeData(provider, transaction),
    provider,
    contracts: new CeloContracts(provider),
  };
};

class CeloContracts {
  private registry: Contract;

  constructor(public provider: providers.Provider) {
    this.registry = new Contract(REGISTRY_CONTRACT_ADDRESS, registryABI, this.provider);
  }

  async getAddress(contractName: string): Promise<string> {
    return this.registry.getAddressForString(contractName);
  }

  async getAccounts() {
    const address = await this.getAddress("Accounts");
    return new Contract(address, accountsABI, this.provider);
  }

  async getLockedGold() {
    const address = await this.getAddress("LockedGold");
    return new Contract(address, lockedGoldABI, this.provider);
  }

  async getElection() {
    const address = await this.getAddress("Election");
    return new Election(address, this.provider);
  }

  async getCeloToken() {
    const address = await this.getAddress("GoldToken");
    return new Contract(address, celoToken.goldTokenABI, this.provider);
  }
}

export const getAccountRegistrationStatus = async (address: string): Promise<boolean> => {
  const accounts = await celoKit().contracts.getAccounts();
  return await accounts.isAccount(address);
};

export const getPendingWithdrawals = async (address: string) => {
  const lockedGold = await celoKit().contracts.getLockedGold();
  const pendingWithdrawals = await lockedGold.getPendingWithdrawals(address);
  return pendingWithdrawals
    .map((withdrawal, index) => ({
      ...withdrawal,
      index,
    }))
    .sort((a, b) => a.time.sub(b.time).toNumber());
};

export const getVotes = async (address: string): Promise<CeloVote[]> => {
  const election = await celoKit().contracts.getElection();
  const voterAddress = await voteSignerAccount(address);
  // This is not a contract method but wrather was a method on the contractkit wrapper. so need to implement here
  const voter = await election.getVoter(voterAddress);
  const activates = await getActivateTransactionObjects(address);
  const activatableValidatorGroups = activates.map(activate => activate.args[0]);

  const votes: CeloVote[] = [];
  for (const vote of voter.votes) {
    let activeVoteRevokable = true;
    if (vote.pending.gt(0)) {
      activeVoteRevokable = false;
      votes.push({
        validatorGroup: vote.group,
        amount: vote.pending,
        activatable: activatableValidatorGroups.includes(vote.group),
        revokable: true,
        index: 0,
        type: "pending",
      });
    }
    if (vote.active.gt(0)) {
      votes.push({
        validatorGroup: vote.group,
        amount: vote.active,
        activatable: false,
        revokable: activeVoteRevokable,
        index: 1,
        type: "active",
      });
    }
  }

  return votes;
};

const getActivateTransactionObjects = async (address: string) => {
  const election = await celoKit().contracts.getElection();
  const voterAddress = await voteSignerAccount(address);
  return await election.populate.activate(voterAddress);
};

export const voteSignerAccount = makeLRUCache(
  async (address: string): Promise<string> => {
    const accounts = await celoKit().contracts.getAccounts();
    return await accounts.voteSignerToAccount(address);
  },
  address => address,
  {
    ttl: 60 * 60 * 1000, // 1 hour
  },
);

// Utility functions
// function proxyCall(method: any, parser?: any, transformer?: any) {
//   return async (...args: any[]) => {
//     const result = await method(...args);
//     return transformer ? transformer(result) : result;
//   };
// }

// function proxySend(connection: ethers.providers.Provider, method: any) {
//   return async (...args: any[]) => {
//     const tx = await method(...args);
//     return connection.sendTransaction(tx);
//   };
// }


async function getFeeData(provider: providers.StaticJsonRpcProvider, transaction: CeloTx) {
  if (!transaction.feeCurrency) {
    const fees = await provider.getFeeData();

    return {
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    };
  } else {
    // TODO what is the type of the return values ?
    const [gasPrice, maxPriorityFeePerGas] = await Promise.all([
      provider.send("eth_gasPrice", [transaction.feeCurrency]),
      provider.send("eth_maxPriorityFeePerGas", [transaction.feeCurrency]),
    ]);

    // on celo eth_gasPrice is already multiply of baseFeePerGas
    return {
      maxFeePerGas: gasPrice + maxPriorityFeePerGas,
      maxPriorityFeePerGas: maxPriorityFeePerGas,
    };
  }
}
