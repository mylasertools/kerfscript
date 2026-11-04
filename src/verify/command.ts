// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

// Node host only. The portable verifier never imports this module.
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { render, type RenderOptions } from '../render.js';
import { parse } from '../parser.js';
import { withBuiltinFont } from '../font.js';
import { findProject, readManifest, resolver } from '../libraries.js';
import { verify, snapshotFromRender } from './index.js';
import { validateSpec } from './spec.js';
import { triageText } from './summary.js';
import type { VerificationResult, VerificationSnapshot, VerificationSpec } from './types.js';

const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');

export function verificationCommand(args: string[]): void {
  let file = '',
    specFile = '',
    out = '',
    summary = false;
  const fonts: Record<string, Uint8Array> = Object.create(null);
  const emit = (result: VerificationResult) => {
    const json = JSON.stringify(result, null, 2) + '\n';
    // What did not pass, grouped, for a person to read; the report is unchanged
    if (summary) process.stderr.write(triageText(result));
    try {
      if (out) writeFileSync(out, json);
      else process.stdout.write(json);
    } catch (e) {
      process.stderr.write(`Could not write verification report: ${(e as Error).message}\n`);
      process.exitCode = 2;
      return;
    }
    process.exitCode =
      result.kind === 'report'
        ? result.report.status === 'pass'
          ? 0
          : result.report.status === 'fail'
            ? 1
            : 2
        : 2;
  };
  try {
    for (let i = 0; i < args.length; i++) {
      const a = args[i],
        next = () =>
          args[++i] ??
          (() => {
            throw new Error(`${a} needs a value`);
          })();
      if (a === '--spec') specFile = next();
      else if (a === '--summary') summary = true;
      else if (a === '-o' || a === '--out') out = next();
      else if (a === '--font') {
        const p = next();
        fonts[basename(p, extname(p))] = readFileSync(p);
      } else if (a.startsWith('-')) throw new Error(`Unknown verify option ${a}`);
      else if (!file) file = a;
      else throw new Error(`Unexpected argument ${a}`);
    }
    if (!file || !specFile)
      throw new Error('Use kerf verify model.kerf --spec model.verify.json [-o report.json].');
    const input = JSON.parse(readFileSync(specFile, 'utf8'));
    const invalid = validateSpec(input);
    if (invalid.length) {
      emit({ kind: 'invalid-spec', issues: invalid });
      return;
    }
    const spec = input as VerificationSpec;
    // Bound orchestration before rendering a malicious or accidental huge case set.
    if (spec.configurations.length > 100 || spec.claims.length > 1000)
      throw new Error('Verification supports at most 100 configurations and 1000 claims per run.');
    const source = readFileSync(file, 'utf8'),
      resolveLib = resolver(file);
    // A configuration must set settings the model has, or a typo would
    // verify the defaults under the configuration's name
    const assigned = new Set(
      parse(source).program.body.flatMap((s) => (s.kind === 'assign' ? [s.name] : [])),
    );
    const unknown = spec.configurations.flatMap((c) =>
      Object.keys(c.params ?? {})
        .filter((k) => !k.startsWith('$') && !assigned.has(k))
        .map((k) => ({
          code: 'unknown-parameter',
          message: `${c.id}: ${k} is not a setting of ${basename(file!)}.`,
        })),
    );
    if (unknown.length) {
      emit({ kind: 'invalid-spec', issues: unknown });
      return;
    }
    const dependencies: Record<string, string> = Object.create(null),
      cache = new Map<string, string | undefined>();
    const resolveSource = (path: string) => {
      if (!cache.has(path)) cache.set(path, resolveLib(path));
      const value = cache.get(path);
      if (value !== undefined) dependencies[path] = sha(value);
      return value;
    };
    const resolvedFonts = withBuiltinFont(fonts),
      fontHashes: Record<string, string> = Object.create(null);
    for (const [name, data] of Object.entries(resolvedFonts)) fontHashes[name] = sha(data);
    // The actual loaded CLI artifact bundles the engine, standard library and
    // verifier; package version alone would not identify a changing checkout.
    const engineHash = sha(readFileSync(fileURLToPath(import.meta.url)));
    const project = findProject(dirname(resolve(file)));
    const defaultSheet = project ? readManifest(project).sheet : undefined;
    const snapshots: VerificationSnapshot[] = [];
    for (const configuration of spec.configurations) {
      const params = configuration.params ?? {};
      const renderSettings = defaultSheet ? { defaultSheet } : {};
      const provenance = () => ({
        sourceHash: sha(source),
        engineHash,
        dependencies: { ...dependencies },
        fonts: fontHashes,
      });
      try {
        const opts: RenderOptions = {
          analysis: true,
          params,
          resolve: resolveSource,
          fonts: resolvedFonts,
          ...(defaultSheet && { defaultSheet }),
        };
        const result = render(source, opts);
        snapshots.push(
          snapshotFromRender(result, {
            configuration: configuration.id,
            params,
            renderSettings,
            provenance: provenance(),
          }),
        );
      } catch (e) {
        snapshots.push({
          schemaVersion: 1,
          configuration: configuration.id,
          params,
          renderSettings,
          provenance: provenance(),
          parts: [],
          hardware: [],
          warnings: [],
          legacyHardware: false,
          relationsKnown: true,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    emit(verify(spec, snapshots));
  } catch (e) {
    emit({
      kind: 'invalid-spec',
      issues: [{ code: 'verification-input', message: (e as Error).message }],
    });
  }
}
