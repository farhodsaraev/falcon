// Jarvis's "hands": the actions the voice model is allowed to call.
// Each tool has a description and a parameter schema (handed to the AI model),
// a `risky` flag (risky tools need the user's "Allow"), and a `run` function.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runPs } from './powershell.js';
import { resolveRecipient, sendEmail } from './email.js';
import { isAllowedPath } from '../config.js';

function requireAllowed(file, config) {
  if (!isAllowedPath(file, config)) {
    throw new Error(`"${file}" is outside the folders Jarvis is allowed to use.`);
  }
  if (!fs.existsSync(file)) throw new Error(`"${file}" does not exist.`);
}

export const tools = [
  {
    name: 'find_files',
    description: 'Find files on the PC by words in the file name, newest first.',
    risky: false,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words that appear in the file name, e.g. "invoice"' },
        extension: { type: 'string', description: 'Optional file type, e.g. "pdf" or "pptx"' },
      },
      required: ['query'],
    },
    run: ({ query, extension }, ctx) =>
      runPs('find-files.ps1', {
        Query: query, Ext: extension, Folders: ctx.config.allowedFolders.join(';'),
      }).then((r) => ({ files: r.files })),
  },
  {
    name: 'open_file',
    description: 'Open a file or folder in its usual app.',
    risky: false,
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Full path of the file' } },
      required: ['path'],
    },
    run: ({ path: file }, ctx) => {
      requireAllowed(file, ctx.config);
      return new Promise((resolve, reject) => {
        execFile('explorer.exe', [path.resolve(file)], () => resolve({ opened: file }));
      });
    },
  },
  {
    name: 'show_slide',
    description: 'Open a PowerPoint presentation and/or jump to a slide number. ' +
      'Leave path empty to use the presentation that is already open.',
    risky: false,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Full path of the .pptx file (optional)' },
        slide: { type: 'integer', description: 'Slide number to show (optional)' },
      },
    },
    run: ({ path: file, slide }, ctx) => {
      if (file) requireAllowed(file, ctx.config);
      return runPs('slides.ps1', { Path: file, Slide: slide })
        .then(({ name, slide: current, total }) => ({ name, slide: current, total }));
    },
  },
  {
    name: 'capture_screen',
    description: 'Take a picture of the screen so it can be described.',
    risky: false,
    parameters: { type: 'object', properties: {} },
    run: async () => {
      const out = path.join(os.tmpdir(), `jarvis-screen-${Date.now()}.png`);
      const r = await runPs('screenshot.ps1', { Out: out });
      return { imagePath: r.path, width: r.width, height: r.height };
    },
  },
  {
    name: 'send_email',
    description: 'Send an email, optionally with files attached. Always asks the user first.',
    risky: true,
    parameters: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Contact name or email address' },
        subject: { type: 'string' },
        body: { type: 'string' },
        attachments: { type: 'array', items: { type: 'string' }, description: 'Full file paths' },
      },
      required: ['to', 'subject', 'body'],
    },
    // What the "Allow?" prompt shows the user.
    summarize: (args, ctx) => {
      const to = resolveRecipient(args.to, ctx.config.contacts);
      const files = (args.attachments || []).map((f) => path.basename(f));
      return `Send email to ${to}: "${args.subject}"` +
        (files.length ? ` with ${files.join(', ')}` : '');
    },
    run: (args, ctx) => {
      const to = resolveRecipient(args.to, ctx.config.contacts);
      for (const file of args.attachments || []) requireAllowed(file, ctx.config);
      return sendEmail({ ...args, to }, ctx.gmail, ctx.mailTransport);
    },
  },
];

/**
 * Runs a tool by name. Risky tools go through `ctx.approve(summary)` first;
 * without an approver, or with a "no", nothing happens.
 * Always returns a plain object the voice model can read back.
 */
export async function callTool(name, args, ctx) {
  const tool = tools.find((t) => t.name === name);
  if (!tool) return { ok: false, error: `Unknown action "${name}".` };
  try {
    if (tool.risky) {
      const summary = tool.summarize ? tool.summarize(args, ctx) : `${name}`;
      const allowed = ctx.approve ? await ctx.approve(summary) : false;
      if (!allowed) return { ok: false, declined: true, error: 'The user did not allow this.' };
    }
    return { ok: true, ...(await tool.run(args || {}, ctx)) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** Tool list in the shape the OpenAI voice model expects. */
export function toolSchemas() {
  return tools.map(({ name, description, parameters }) => ({ type: 'function', name, description, parameters }));
}
