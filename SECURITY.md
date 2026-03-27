# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| `main` | :white_check_mark: |
| Latest published release | :white_check_mark: |

## Reporting a vulnerability

We take the security of HOL software seriously. If you discover a security issue in this repository:

1. Do not disclose the issue publicly before the maintainers have had time to assess it.
2. Send a report to support@hashgraphonline.com.
3. Include the following details when possible:
   - a description of the issue
   - impact and affected surfaces
   - reproduction steps
   - logs, screenshots, or proof of concept details
   - suggested mitigations if you have them

We aim to acknowledge security reports within 48 hours and provide an initial assessment within 72 hours.

## Security best practices

When working with this plugin:

1. Use the latest released version of the package.
2. Keep broker credentials and API keys out of source control.
3. Avoid documenting private broker deployment details in public files.
4. Validate external broker inputs and responses before acting on them.
5. Re-run the broker-backed smoke test after changes that affect delegation, chat, or history flows.

## Contact

For security-related inquiries, contact support@hashgraphonline.com.
