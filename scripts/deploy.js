'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT_ID = /^[A-Za-z0-9_-]{20,}$/;
const ARTIFACT_FILES = ['Code.gs', 'appsscript.json'];

function parseArgs(args) {
  const options = { action: args[0], dryRun: false, open: true };
  if (!['setup', 'upload'].includes(options.action)) throw new Error('Use setup or upload.');
  for (let index = 1; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--dry-run') options.dryRun = true;
    else if (argument === '--no-open') options.open = false;
    else if (argument === '--retry-create' && options.action === 'setup') options.retryCreate = true;
    else if (argument === '--script-id' && options.action === 'setup' && !options.scriptId) {
      options.scriptId = args[++index];
      if (!SCRIPT_ID.test(options.scriptId || '')) throw new Error('Provide a valid standalone Apps Script ID after --script-id.');
    } else throw new Error('Unknown option: ' + argument);
  }
  if (options.retryCreate && options.scriptId) throw new Error('Use --script-id or --retry-create, not both.');
  return options;
}

function readConfig(root) {
  const filename = path.join(root, '.clasp.json');
  if (!fs.existsSync(filename)) return null;
  const config = JSON.parse(fs.readFileSync(filename, 'utf8'));
  if (!SCRIPT_ID.test(config.scriptId || '') || config.scriptId.startsWith('REPLACE_')) {
    throw new Error('.clasp.json has no valid Script ID. Remove the placeholder file and run npm run setup.');
  }
  if (typeof config.rootDir !== 'string' || path.resolve(root, config.rootDir) !== path.join(root, 'dist')) {
    throw new Error('Refusing to upload: .clasp.json rootDir must point to this repository\'s dist folder.');
  }
  return config;
}

function checkUploadFiles(root, files) {
  const expected = ARTIFACT_FILES.map(file => path.join(root, 'dist', file)).sort();
  if (!Array.isArray(files) || files.some(file => typeof file !== 'string')) {
    throw new Error('clasp did not report a valid upload file list.');
  }
  const actual = files.map(file => path.resolve(root, file)).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error('Refusing to upload: clasp must include exactly dist/Code.gs and dist/appsscript.json. Check .clasp.json and .claspignore.');
  }
}

function validateArtifact(root) {
  const directory = path.join(root, 'dist');
  if (!fs.existsSync(directory)) throw new Error('Build files are missing. Run npm run build.');
  const files = fs.readdirSync(directory).sort();
  if (JSON.stringify(files) !== JSON.stringify(ARTIFACT_FILES.slice().sort())) {
    throw new Error('dist must contain only Code.gs and appsscript.json. Remove unexpected files before uploading.');
  }
  for (const filename of files) {
    if (!fs.lstatSync(path.join(directory, filename)).isFile()) throw new Error('Upload artifacts must be regular files.');
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'appsscript.json'), 'utf8'));
  if (!manifest.addOns || !manifest.addOns.common || !manifest.addOns.docs ||
      manifest.runtimeVersion !== 'V8' ||
      JSON.stringify(manifest.oauthScopes) !== JSON.stringify(['https://www.googleapis.com/auth/documents.currentonly'])) {
    throw new Error('Build the Google Docs Workspace add-on manifest before uploading.');
  }
}

function runClasp(root, args, json) {
  const binary = path.join(root, 'node_modules', '@google', 'clasp', 'build', 'src', 'index.js');
  if (!fs.existsSync(binary)) throw new Error('Local clasp is not installed. Run npm ci first.');
  const result = spawnSync(process.execPath, [binary, ...(json ? ['--json'] : []), ...args], {
    cwd: root,
    encoding: 'utf8',
    // clasp opens a browser only with a terminal stdout. Preserve that for
    // open-script; JSON management commands are captured for verification.
    stdio: json ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'],
    timeout: 120000,
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'clasp failed.').trim() +
      '\nCheck npm run clasp:login and enable the Apps Script API at https://script.google.com/home/usersettings.');
  }
  if (!json) return (result.stdout || '').trim();
  try { return JSON.parse(result.stdout); }
  catch { throw new Error('clasp returned an unexpected response. Check the configured project before retrying.'); }
}

function rebuild(root) {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'build.js')], {
    cwd: root, stdio: 'inherit', windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Build failed; nothing was uploaded.');
}

function runWorkflow(root, options, dependencies = {}) {
  root = path.resolve(root);
  const run = dependencies.run || ((args, json = true) => runClasp(root, args, json));
  const build = dependencies.build || (() => rebuild(root));
  const log = dependencies.log || console.log;
  let config = readConfig(root);
  const pendingFile = path.join(root, '.clasp-create-pending.json');
  const pending = fs.existsSync(pendingFile);
  if (config && options.scriptId && options.scriptId !== config.scriptId) {
    throw new Error('This repository is already linked to another script. Refusing to switch projects.');
  }
  if (!config && options.action === 'upload') {
    throw new Error('No project is linked yet. Run npm run setup first.');
  }
  if (pending && !config && !options.scriptId && !options.retryCreate) {
    throw new Error('An earlier project creation did not finish. Check https://script.google.com/home for Sentence Tools. ' +
      'Reuse its ID with npm run setup -- --script-id YOUR_SCRIPT_ID. If no project was created, use npm run setup -- --retry-create.');
  }
  if (!pending) validateArtifact(root);
  if (options.dryRun) {
    log(config ? 'Would update the configured Apps Script project.' :
      options.scriptId ? 'Would link the supplied standalone Script ID.' : 'Would create a standalone Apps Script project named Sentence Tools.');
    log('Would upload only dist/Code.gs and dist/appsscript.json; no Marketplace publication.');
    if (options.action === 'setup' && options.open) log('Would open the Apps Script editor for personal installation.');
    return { dryRun: true };
  }

  const account = run(['show-authorized-user']);
  if (!account.loggedIn) {
    throw new Error('Sign in first: npm run clasp:login\nEnable the Apps Script API at https://script.google.com/home/usersettings, then rerun npm run ' + options.action + '.');
  }
  log(account.email ? 'Using clasp account: ' + account.email : 'Using your signed-in clasp account.');
  if (pending) {
    // The marker is written only after validating that dist had exactly our two
    // artifacts. Thus Code.js can only be a starter from the interrupted pull.
    fs.rmSync(path.join(root, 'dist', 'Code.js'), { force: true });
    build();
    validateArtifact(root);
  }

  if (!config) {
    if (options.scriptId) {
      config = { scriptId: options.scriptId, rootDir: 'dist' };
      // The explicit Script ID must refer to a dedicated standalone project;
      // push replaces its script files with this repository's build.
      fs.writeFileSync(path.join(root, '.clasp.json'), JSON.stringify(config, null, 2) + '\n', { flag: 'wx' });
    } else {
      log('Creating your standalone Sentence Tools project...');
      if (!pending) {
        fs.writeFileSync(pendingFile, JSON.stringify({ title: 'Sentence Tools', startedAt: new Date().toISOString() }) + '\n', { flag: 'wx' });
      }
      let created;
      try {
        created = run(['create-script', '--type', 'standalone', '--title', 'Sentence Tools', '--rootDir', 'dist']);
      } catch (error) {
        // Creation can succeed remotely before clasp fails while pulling the
        // starter files. Point to recovery instead of silently creating again.
        throw new Error(error.message + '\nCheck Apps Script before retrying: reuse a created project with npm run setup -- --script-id YOUR_SCRIPT_ID; if no project exists, use npm run setup -- --retry-create.');
      }
      config = readConfig(root);
      if (!config || created.scriptId !== config.scriptId) {
        throw new Error('Project creation returned unexpected configuration. Check Apps Script and .clasp.json before retrying.');
      }
      // clasp normally prefers .js for pulled server-side code. A newly created
      // project may include a starter Code.js; it was absent before creation.
      // Remove only that returned starter, leaving every source file untouched.
      if (Array.isArray(created.files) && created.files.some(file =>
        path.resolve(root, file) === path.join(root, 'dist', 'Code.js'))) {
        fs.rmSync(path.join(root, 'dist', 'Code.js'), { force: true });
      }
      // clasp creation pulls a starter manifest into dist. Rebuild from src so
      // the uploaded manifest always includes the Workspace add-on declaration.
      build();
      validateArtifact(root);
    }
  }

  fs.rmSync(pendingFile, { force: true });
  const status = run(['show-file-status']);
  checkUploadFiles(root, status.filesToPush);
  log('Uploading to the dedicated Sentence Tools project...');
  // The dedicated project is fully managed by this repo. --force acknowledges
  // manifest updates; without it clasp can silently skip noninteractive pushes.
  const pushed = run(['push', '--force']);
  if (!Array.isArray(pushed)) {
    throw new Error('Unexpected upload result. Check the files in the Apps Script editor.');
  }
  if (pushed.length) {
    try { checkUploadFiles(root, pushed); }
    catch { throw new Error('Unexpected upload result. Check the files in the Apps Script editor before retrying.'); }
  }
  const editorUrl = 'https://script.google.com/home/projects/' + config.scriptId + '/edit';
  log(pushed.length ? 'Uploaded the add-on.' : 'The add-on is already up to date.');
  log(editorUrl);
  if (options.action === 'setup') {
    log('Install once in the editor: Deploy > Test deployments > Install > Done.');
    if (options.open) {
      try { run(['open-script'], false); }
      catch { log('Open the editor link above to finish installation.'); }
    }
  } else {
    log('Refresh Google Docs and reopen the Sentence Tools side panel.');
  }
  return { scriptId: config.scriptId, editorUrl, pushed };
}

if (require.main === module) {
  try { runWorkflow(path.resolve(__dirname, '..'), parseArgs(process.argv.slice(2))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { parseArgs, readConfig, validateArtifact, checkUploadFiles, runWorkflow };
