# Security policy

## Report a vulnerability

Report vulnerabilities privately through GitHub's private vulnerability reporting: open the [Security tab](https://github.com/NickSuomi/heron/security) of this repository and choose **Report a vulnerability**, or go to [the new advisory form](https://github.com/NickSuomi/heron/security/advisories/new) directly.

Do not open a public issue for a vulnerability.

Include the Heron commit you tested, the backend you used, and the steps that show the problem. Remove real tokens, keys, and private source code from the report.

## Supported versions

Heron has no releases yet. Fixes land on the `main` branch.

## Scope

[docs/security.md](docs/security.md) describes what Heron is designed to protect and the limits of that design. A way around a protection described there is in scope. A model reaching a wrong verdict because of text in the merge request is a known limit, unless it lets the model do something beyond reading the reviewed commit.
