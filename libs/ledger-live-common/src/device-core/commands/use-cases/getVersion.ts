import { identifyTargetId } from "@ledgerhq/devices";
import Transport from "@ledgerhq/hw-transport";
import { FirmwareInfoEntity } from "../entities/FirmwareInfoEntity";
import { isDeviceLocalizationSupported } from "./isDeviceLocalizationSupported";
import { isHardwareVersionSupported } from "./isHardwareVersionSupported";
import { isBootloaderVersionSupported } from "./isBootloaderVersionSupported";

export function parseGetVersionResult(res: Buffer): FirmwareInfoEntity {
  const data = res.slice(0, res.length - 2);
  let i = 0;

  // parse the target id of either BL or SE
  const targetId = data.readUIntBE(0, 4);
  i += 4;

  // parse the version of either BL or SE
  const rawVersionLength = data[i++];
  let rawVersion = data.slice(i, i + rawVersionLength).toString();
  i += rawVersionLength;

  // flags. gives information about manager allowed in SE mode.
  const flagsLength = data[i++];
  let flags = data.slice(i, i + flagsLength);
  i += flagsLength;

  if (!rawVersionLength) {
    // To support old firmware like bootloader of 1.3.1
    rawVersion = "0.0.0";
    flags = Buffer.allocUnsafeSlow(0);
  }

  let mcuVersion = "";
  let mcuBlVersion: string | undefined;
  let seVersion: string | undefined;
  let bootloaderVersion: string | undefined;
  let hardwareVersion: number | undefined;
  let mcuTargetId: number | undefined;
  let seTargetId: number | undefined;
  let languageId: number | undefined;

  const isBootloader = (targetId & 0xf0000000) !== 0x30000000;

  if (isBootloader) {
    mcuBlVersion = rawVersion;
    mcuTargetId = targetId;

    if (i < data.length) {
      // se part 1
      const part1Length = data[i++];
      const part1 = data.slice(i, i + part1Length);
      i += part1Length;

      // at this time, this is how we branch old & new format
      if (part1Length >= 5) {
        seVersion = part1.toString();
        // se part 2
        const part2Length = data[i++];
        const part2 = data.slice(i, i + part2Length);
        i += flagsLength;
        seTargetId = part2.readUIntBE(0, 4);
      } else {
        seTargetId = part1.readUIntBE(0, 4);
      }
    }
  } else {
    seVersion = rawVersion;
    seTargetId = targetId;

    // if SE: mcu version
    const mcuVersionLength = data[i++];
    let mcuVersionBuf: Buffer = Buffer.from(data.slice(i, i + mcuVersionLength));
    i += mcuVersionLength;

    if (mcuVersionBuf[mcuVersionBuf.length - 1] === 0) {
      mcuVersionBuf = mcuVersionBuf.slice(0, mcuVersionBuf.length - 1);
    }
    mcuVersion = mcuVersionBuf.toString();

    const isOSU = rawVersion.includes("-osu");

    if (!isOSU) {
      const deviceModel = identifyTargetId(targetId);

      if (isBootloaderVersionSupported(seVersion, deviceModel?.id)) {
        const bootloaderVersionLength = data[i++];
        let bootloaderVersionBuf: Buffer = Buffer.from(data.slice(i, i + bootloaderVersionLength));
        i += bootloaderVersionLength;

        if (bootloaderVersionBuf[bootloaderVersionBuf.length - 1] === 0) {
          bootloaderVersionBuf = bootloaderVersionBuf.slice(0, bootloaderVersionBuf.length - 1);
        }
        bootloaderVersion = bootloaderVersionBuf.toString();
      }

      if (isHardwareVersionSupported(seVersion, deviceModel?.id)) {
        const hardwareVersionLength = data[i++];
        hardwareVersion = data.slice(i, i + hardwareVersionLength).readUIntBE(0, 1); // ?? string? number?
        i += hardwareVersionLength;
      }

      if (isDeviceLocalizationSupported(seVersion, deviceModel?.id)) {
        const languageIdLength = data[i++];
        languageId = data.slice(i, i + languageIdLength).readUIntBE(0, 1);
      }
    }
  }

  return {
    isBootloader,
    rawVersion,
    targetId,
    seVersion,
    mcuVersion,
    mcuBlVersion,
    mcuTargetId,
    seTargetId,
    flags,
    bootloaderVersion,
    hardwareVersion,
    languageId,
  };
}

/**
 * Get the FirmwareInfo of a given device
 *
 * @param transport
 * @param options - Contains optional options:
 *  - abortTimeoutMs: aborts the APDU exchange after a given timeout
 */
export async function getVersion(
  transport: Transport,
  { abortTimeoutMs }: { abortTimeoutMs?: number } = {},
): Promise<FirmwareInfoEntity> {
  const res = await transport.send(0xe0, 0x01, 0x00, 0x00, undefined, undefined, {
    abortTimeoutMs,
  });
  return parseGetVersionResult(res);
}
