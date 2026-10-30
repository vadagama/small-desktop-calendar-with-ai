import {
  flipFuses,
  getCurrentFuseWire,
  FuseState,
  FuseV1Options,
  FuseVersion,
} from "@electron/fuses";

export const productionFuses = {
  version: FuseVersion.V1,
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
};

export async function hardenElectron(app) {
  await flipFuses(app, productionFuses);
}

export async function verifyFuses(app) {
  const actual = await getCurrentFuseWire(app);
  for (const [option, enabled] of Object.entries(productionFuses)) {
    if (option === "version") continue;
    if (actual[option] !== (enabled ? FuseState.ENABLE : FuseState.DISABLE))
      throw new Error(`Unexpected Electron fuse: ${FuseV1Options[option]}`);
  }
  console.log("Production Electron fuses verified");
}
