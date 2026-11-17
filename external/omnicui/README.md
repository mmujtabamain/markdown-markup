# external/omnicui

[omnicui](https://github.com/mmujtabamain/omnicui) checks that one UI component, written by hand
in several stacks, behaves, looks and moves the same. MKP uses it for its widget contracts: one
contract per core extern widget, in `targets/checks/contracts/`, run on the web, egui and Android
targets through their adapters (`targets/checks/targets/*/target.yaml`).

omnicui is vendored by its release, as omnicui's own README says a project should, and not by a
copy of its repository. This folder holds only three files:

- `omnicui.lock`: the release MKP uses (its version, the commit it was released from, where its
  files are) and the SHA-256 of each file, from the release's own `SHA256SUMS`;
- `fetch.sh`: prints the path of that release's binary for this machine, downloading it the first
  time and refusing it unless its hash matches the lock; with no binary for the machine, or with
  `--source`, it builds the release's source tarball with Go instead;
- this README.

What `fetch.sh` downloads stays in `bin/` and `src/` here, which git ignores.

## Running the contracts

```sh
"$(external/omnicui/fetch.sh)" --project targets/checks check web       # or egui, android
```

`targets/ts/web`'s `npm test` does the same for the web target, through `fetch.sh`.

## Changing omnicui

omnicui is never edited here or anywhere in MKP.

- **A change to omnicui** goes into omnicui's own repository. Its CI releases a new version when its
  `VERSION` goes up. MKP then moves to it with one commit to `omnicui.lock`: the new version, the
  commit, the release's address and every hash from its `SHA256SUMS`.
- **Trying a build that isn't released:** set `OMNICUI_BINARY` to it. `fetch.sh` and the tests
  use it as it is, unchecked, and the lock stays as it was.
- **MKP's side** (the contracts, the adapters and the omnicui targets) lives in `targets/` and
  changes like any other MKP code.

The contracts' first line points editors at the schema of the release in the lock:
`https://raw.githubusercontent.com/mmujtabamain/omnicui/v0.2.4/tools/omnicui/schema/contract.schema.json`.
Change it with the lock.
