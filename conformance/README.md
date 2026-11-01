# Conformance suite

Small KerfScript programs with their expected results. Together they make
the [specification](../docs/specification.md) testable: an implementation
conforms to language version 0.1 when it gives the expected result for
every case. They also protect existing designs, since a change that alters
the result of a case changes the language.

Run them with `npm run build && npm test`. `test/conformance.test.mjs` is
the runner for this implementation; another implementation can read the
same files with its own runner.

## Layout

- `cases/<topic>/<name>.kerf`: one case per file, grouped by the
  specification section it tests.
- `lib/<name>.kerf`: libraries for the cases. `use <name>` in a case reads
  `lib/<name>.kerf`; paths starting with `kerf/` are the built-in standard
  library.

## Case format

A case starts with a comment saying what it checks, then lines starting
with `// => ` that give the expected result, then the program:

```kerf
// % keeps the sign of the left operand
// => echo: 1, -1, 1, 1.5
echo(7 % 3, -7 % 3, 7 % -3, 5.5 % 2);
```

| Line                            | Meaning                                                                                                                                                                                |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `// => echo: text`              | one line of `echo()` output. The lines must match in order, and a case with none must write nothing.                                                                                   |
| `// => error: message`          | the program stops with this error, including its position. Without one, the program must not stop.                                                                                     |
| `// => warning: message`        | one warning. When a case has any, the warnings must match in order; otherwise they are not checked.                                                                                    |
| `// => part: "name" key=value`  | a part and some of its properties: `qty`, `size` (`20x10`), `pieces`, `cut` (cut length), `thickness`, `kerf`, `material`. When a case has any, it must make exactly the parts listed. |
| `// => layer: "name" key=value` | a layer and its total `area` of closed shapes or `length` of open lines, in millimetres. When a case has any, exactly the listed layers must have shapes.                              |
| `// => with: {...}`             | render options for the case, as JSON: `params`, `guides`, `maxSteps` and the others in the [JavaScript API](../docs/javascript.md).                                                    |

Numbers in `part` and `layer` lines may differ by 0.01. Everything else is
compared exactly.

## Adding a case

Add a case for each rule the specification states and for each bug fixed in
how programs evaluate. Keep a case to one rule, with the smallest program
that shows it, and name the file after the rule. When a change to the
language is meant to alter a result, change the case in the same commit
and say so in the changelog.

The examples are checked separately: `test/examples.test.mjs` compares
every example's parts, layers, output and warnings with
`test/snapshots/examples.json`. After a change that is meant to alter
them, run `npm run snapshots`.
