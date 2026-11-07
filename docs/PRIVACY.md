# Privacy and permissions

Sentence Tools is a Google Workspace add-on running in Google Apps Script under the account that presses its side-panel buttons. It reads the current selection and containing paragraph text to identify sentence boundaries and validate supported content, then edits the selected ranges in that document.

## Runtime permission

The manifest requests:

```text
https://www.googleapis.com/auth/documents.currentonly
```

The script also declares `@OnlyCurrentDoc`. The requested document access is scoped to the document where the add-on is used. The account installation makes the add-on available in different Docs; it does not make the formatting commands scan every document in Drive. See Google's [authorization guidance](https://developers.google.com/apps-script/guides/services/authorization#manual_authorization_scopes_for_sheets_docs_slides_and_forms).

The runtime does not call external AI services, send document text to third-party endpoints, collect analytics, or require an API key. It does not keep a separate copy of selected text. Execution takes place within Google's Docs and Apps Script environment.

Google may retain execution metadata and error information as part of Apps Script. The manifest enables standard `STACKDRIVER` exception logging. The project does not deliberately log selected document text. The add-on's hosted icon may be fetched by the Google interface; it does not contain or receive selected text.

## Local setup and uploads

The repository includes `@google/clasp` 3.4.1 as a pinned development dependency. Installing dependencies downloads tooling from the npm registry. Clasp uses Google sign-in and separate deployment permissions to create the standalone script project and upload source. Those tooling permissions are distinct from the add-on's current-document runtime scope.

`npm run clasp:login` stores its Google tokens in the default user-profile `.clasprc.json` file, outside this repository. On Windows that is normally `%USERPROFILE%\.clasprc.json`. `npm run clasp:logout` signs clasp out. Do not copy credentials into source control or share them.

The local `.clasp.json` stores the configured Script ID and the `dist` upload path; it contains project configuration rather than the sign-in token. It is ignored by Git, as are common clasp credential files. Only generated Apps Script source and its manifest are intended for upload.

`npm run setup` creates or reuses the configured standalone Apps Script project and uploads the code. `npm run upload` updates that project. These operations do not publish a Marketplace listing, share your documents, or install the add-on automatically. Personal installation and authorization happen separately in Google's browser interface.
