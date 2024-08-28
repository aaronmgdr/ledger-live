import { Contract, providers } from "ethers";
import ElectionABI from "./abis/election.json";
import { IElection } from "./contracts/Election";
import BigNumber from "bignumber.js";
import { getAddress } from "ethers/lib/utils";

const NULL_ADDRESS = "0x0000000000000000000000000000000000000000";

interface Revocation {
  method: "revokePending" | "revokeActive";
  data: string;
}

interface Activation {
  method: "activate" | "activateForAccount";
  args: string[];
  data: string;
}

export class Election {
  private contract: IElection;
  constructor(address: string, provider: providers.Provider) {
    this.contract = new Contract(address, ElectionABI.abi, provider) as IElection;
  }

  get address() {
    return this.contract.address;
  }

  get interface() {
    return this.contract.interface;
  }
  get estimateGas() {
    return this.contract.estimateGas;
  }


  async getVoter(account: string, blockNumber?: number) {
    const groups: string[] = await this.contract.getGroupsVotedForByAccount(account, {
      blockTag: blockNumber,
    });
    const votes = await concurrentMap(10, groups, g =>
      this.getVotesForGroupByAccount(account, g, blockNumber),
    );
    return { address: account, votes };
  }

  async revoke(account: string, group: string, value: BigNumber) {
    const vote = await this.getVotesForGroupByAccount(account, group);
    const total = vote.pending.add(vote.active);
    if (value.gt(total.toHexString())) {
      throw new Error(`can't revoke more votes for ${group} than have been made by ${account}`);
    }
    const txos: Revocation[] = [];
    const pendingValue = BigNumber.minimum(vote.pending.toHexString(), value);
    if (!pendingValue.isZero()) {
      txos.push({
        method: "revokePending",
        data: await this.revokePending(account, group, pendingValue),
      });
    }
    if (pendingValue.lt(value)) {
      const activeValue = value.minus(pendingValue);
      txos.push({
        method: "revokeActive",
        data: await this.revokeActive(account, group, activeValue),
      });
    }
    return txos;
  }

  /**
   * Activates any activatable pending votes.
   * @param account The account with pending votes to activate.
   */
  async activate(account: string, onBehalfOfAccount?: boolean): Promise<Activation[]> {
    const groups: string[] = await this.contract.getGroupsVotedForByAccount(account);
    const isActivatable = await Promise.all(
      groups.map(g => this.contract.hasActivatablePendingVotes(account, g)),
    );
    const groupsActivatable = groups.filter((_, i) => isActivatable[i]);
    return groupsActivatable.map(groupAddress =>
      onBehalfOfAccount
        ? {
            method: "activateForAccount",
            args: [groupAddress, account],
            data: this.contract.interface.encodeFunctionData("activateForAccount", [
              groupAddress,
              account,
            ]),
          }
        : {
            method: "activate",
            args: [groupAddress],
            data: this.contract.interface.encodeFunctionData("activate", [groupAddress]),
          },
    );
  }

  private async getVotesForGroupByAccount(account: string, group: string, blockNumber?: number) {
    const pending = await this.contract.getPendingVotesForGroupByAccount(group, account, {
      blockTag: blockNumber,
    });
    const active = await this.contract.getActiveVotesForGroupByAccount(group, account, {
      blockTag: blockNumber,
    });

    return {
      group,
      pending,
      active,
    };
  }

  private async revokePending(account: string, group: string, value: BigNumber) {
    const groups = await this.contract.getGroupsVotedForByAccount(account);
    const index = findAddressIndex(group, groups);
    const { lesser, greater } = await this.findLesserAndGreaterAfterVote(group, value.times(-1));

    return this.contract.interface.encodeFunctionData("revokeActive", [
      group,
      value.toFixed(),
      lesser,
      greater,
      index,
    ]);
  }

  private async revokeActive(account: string, group: string, value: BigNumber) {
    const { lesser, greater } = await this.findLesserAndGreaterAfterVote(group, value.times(-1));

    const groups = await this.contract.getGroupsVotedForByAccount(account);
    const index = findAddressIndex(group, groups);

    return this.contract.interface.encodeFunctionData("revokeActive", [
      group,
      value.toFixed(),
      lesser,
      greater,
      index,
    ]);
  }

  private async findLesserAndGreaterAfterVote(
    votedGroup: string,
    voteWeight: BigNumber,
  ): Promise<{ lesser: string; greater: string }> {
    const currentVotes = await this.getEligibleValidatorGroupsVotes();
    const selectedGroup = currentVotes.find(votes => eqAddress(votes.address, votedGroup));
    const voteTotal = selectedGroup ? selectedGroup.votes.plus(voteWeight) : voteWeight;
    let greaterKey = NULL_ADDRESS;
    let lesserKey = NULL_ADDRESS;

    for (const vote of currentVotes) {
      if (vote.votes.gt(voteTotal)) {
        lesserKey = vote.address;
        break;
      }
      greaterKey = vote.address;
    }

    return { lesser: lesserKey, greater: greaterKey };
  }

  private async getEligibleValidatorGroupsVotes() {
    const res = await this.contract.getTotalVotesForEligibleValidatorGroups();
    return res[0].map((address: string, index: number) => ({
      address,
      votes: BigNumber(res[1][index].toHexString()),
    }));
  }
}

async function concurrentMap<T, R>(
  concurrency: number,
  arr: T[],
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  const executing: Promise<number>[] = [];
  for (const item of arr) {
    const p = fn(item).then(result => results.push(result));
    executing.push(p);
    if (executing.length >= concurrency) {
      await Promise.race(executing);
      executing.splice(executing.indexOf(p), 1);
    }
  }
  await Promise.all(executing);
  return results;
}

function eqAddress(a: string, b: string) {
  return getAddress(a) === getAddress(b);
}

const findAddressIndex = (address: string, addresses: string[]) =>
  addresses.findIndex(x => eqAddress(x, address));
