import { AccountBridge } from "@ledgerhq/types-live";
import { patchOperationWithHash } from "../../operation";
import { Transaction } from "./types";
import { celoKit } from "./api/sdk";


export const broadcast: AccountBridge<Transaction>["broadcast"] = async ({
  signedOperation: { operation, signature },
}) => {
  const kit = celoKit();
  const transactionResponse = await kit.provider.sendTransaction(signature);
  return patchOperationWithHash(operation, transactionResponse.hash);
};

export default broadcast;
