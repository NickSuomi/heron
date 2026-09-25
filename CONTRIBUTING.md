# Contributing

## Set up

You need Node 24 and pnpm 11.

```sh
pnpm install --frozen-lockfile
pnpm check
```

`pnpm check` runs the type checker and the tests. `pnpm build` compiles `src/` to `dist/`.

## Make a change

- Keep one concern per commit. Commit messages use the `type(scope): summary` form, for example `fix(forge): retry a 429 once`.
- Add or change a test in `test/` for any change in behaviour. Tests use `@effect/vitest`.
- If you change `envVars` in `src/config.ts`, run `pnpm gen-env-table` to update [docs/configuration.md](docs/configuration.md). `pnpm test` fails when they differ.
- Do not commit tokens, keys, or real vendor transcripts. Test fixtures that are not copied from a real run have `.synthetic` in their name.
- Report security problems privately, as [SECURITY.md](SECURITY.md) describes.

## License

Heron is licensed under the [Apache License 2.0](LICENSE). Under section 5 of that license, a contribution you submit is licensed under the same terms unless you state otherwise.
