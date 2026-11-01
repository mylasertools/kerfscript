# Specification

Language version 0.1. Copyright (c) 2026 MyLaserTools. This document is
licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

This document defines KerfScript programs precisely: what text is a
program, what it evaluates to, and when it is an error. The
[language reference](../LANGUAGE.md) explains the same language for people
writing designs and lists the built-in modules and functions; where the two
differ, this document is the one to fix.

The [conformance suite](../conformance/README.md) turns these rules into
small programs with expected results. Each section below names the cases
that test it. An implementation conforms to language version 0.1 when it
passes every case.

## Notation

Grammar rules use EBNF: `{ x }` repeats `x` zero or more times, `[ x ]`
makes it optional, `|` separates choices and quoted text is literal. Rules
in `lower_case` are syntax, built from the tokens in
[Lexical structure](#lexical-structure); rules in `UPPER_CASE` are tokens.

## Source text

A program is a string of Unicode text. Positions in messages are a line
and a column, both counted from 1. Lines end at `\n`; a `\r` before it is
whitespace. Columns count UTF-16 code units, as JavaScript strings and the
Language Server Protocol do, so a character outside the Basic Multilingual
Plane such as an emoji takes two columns.

## Lexical structure

Cases: `lexical/*`.

The text is read from start to end as a sequence of tokens. Whitespace
(space, tab, `\r`, `\n`) and comments separate tokens and are otherwise
ignored.

```ebnf
LINE_COMMENT  = "//" { any character except "\n" } ;
BLOCK_COMMENT = "/*" { any character } "*/" ;   (* ends at the first "*/" *)

NUMBER   = DIGITS [ "." { DIGIT } ] [ EXPONENT ]
         | "." DIGITS [ EXPONENT ] ;
EXPONENT = ( "e" | "E" ) [ "+" | "-" ] DIGITS ;
DIGITS   = DIGIT { DIGIT } ;

STRING   = '"' { CHARACTER | ESCAPE } '"' ;   (* CHARACTER is anything but '"', "\" and "\n" *)
ESCAPE   = "\" ( "n" | "t" | "u" HEX HEX HEX HEX | any other character ) ;

NAME     = ( LETTER | "_" | "$" ) { LETTER | DIGIT | "_" } ;   (* ASCII letters and digits *)

PATH     = "<" PATH_CHARACTER { PATH_CHARACTER } ">" ;
PATH_CHARACTER = LETTER | DIGIT | "_" | "." | "/" | "-" ;

PUNCTUATOR = "<=" | ">=" | "==" | "!=" | "&&" | "||"
           | "+" | "-" | "*" | "/" | "%" | "^" | "<" | ">" | "!" | "?" | ":"
           | "=" | "." | "," | ";" | "(" | ")" | "[" | "]" | "{" | "}" | "#" ;
```

- Where two punctuators could start at the same place, the longer one is
  taken: `<=` is one token, not `<` and `=`.
- A number token's value is the nearest IEEE 754 double. `5.` is the number 5. A number has no sign; `-1` is unary minus applied to `1`.
- In a string, `\n` is a line break, `\t` a tab and `\uXXXX` the UTF-16
  code unit with that hex value. A backslash before any other character
  gives that character, so `\"` is `"`, `\\` is `\` and `\q` is `q`. A
  `\u` not followed by four hex digits is an error.
- A `PATH` token is only read directly after the name `use` or `include`
  (whitespace and comments may come between). Anywhere else `<` is a
  punctuator.
- These names are keywords and cannot name a variable, function, module or
  parameter: `module function if else for let each use include true false undef`.
- A name starting with `$` is a special variable (see
  [Special variables](#special-variables)).

Errors, each at the position given:

| Text                                     | Message                    | Position        |
| ---------------------------------------- | -------------------------- | --------------- |
| a `/*` with no `*/` after it             | `Unclosed block comment`   | the `/*`        |
| a string with no closing `"` on its line | `Unclosed string`          | the opening `"` |
| `\u` without four hex digits             | `Bad \u escape`            | the `\`         |
| a character that starts no token         | `Unexpected character "c"` | the character   |

## Syntax

Cases: `errors/missing-*`, `lexical/keyword-as-name`.

```ebnf
program    = { statement } ;

statement  = ";"
           | "{" { statement } "}"
           | "module" NAME params body
           | "function" NAME params "=" expr ";"
           | ( "use" | "include" ) PATH [ ";" ]
           | "for" bindings body
           | "if" "(" expr ")" body [ "else" body ]
           | "let" bindings body
           | NAME "=" expr ";"
           | [ modifier ] NAME arguments body ;

body       = ";" | "{" { statement } "}" | statement ;
modifier   = "*" | "!" | "#" | "%" ;

params     = "(" [ param { "," param } [ "," ] ] ")" ;
param      = NAME [ "=" expr ] ;
arguments  = "(" [ argument { "," argument } [ "," ] ] ")" ;
argument   = [ NAME "=" ] expr ;
bindings   = "(" [ binding { "," binding } [ "," ] ] ")" ;
binding    = NAME "=" expr ;

expr       = "function" params expr
           | "let" bindings expr
           | or [ "?" expr ":" expr ] ;
or         = and { "||" and } ;
and        = equality { "&&" equality } ;
equality   = comparison { ( "==" | "!=" ) comparison } ;
comparison = sum { ( "<" | "<=" | ">" | ">=" ) sum } ;
sum        = product { ( "+" | "-" ) product } ;
product    = unary { ( "*" | "/" | "%" ) unary } ;
unary      = ( "-" | "+" | "!" ) unary | power ;
power      = postfix [ "^" unary ] ;
postfix    = primary { arguments | "[" expr "]" | "." NAME } ;
primary    = NUMBER | STRING | "true" | "false" | "undef" | NAME
           | "(" expr ")" | list ;

list       = "[" "]"
           | "[" expr ":" expr [ ":" expr ] "]"
           | "[" item { "," item } [ "," ] "]" ;
item       = "for" bindings item
           | "if" "(" expr ")" item [ "else" item ]
           | "let" bindings item
           | "each" expr
           | "(" item ")"     (* only when the item inside starts with for or if *)
           | expr ;
```

The grammar is read with one rule at a time from left to right, choosing
the first choice that fits. Where that needs more than the next token:

- A statement that starts with a name followed by `=` is an assignment.
- `function` followed by a name is a function definition; followed by `(`
  it is a function value.
- `let` followed by `(` is a `let` statement or expression.
- In a list, a first item followed by `:` makes a range: `[0:5]`,
  `[0:2:10]`. With three parts the middle one is the step.
- A `use` or `include` statement may end with `;` or not.
- In arguments and bindings, the name before `=` can be any name, including
  a keyword; it only matters when it matches a parameter.
- Binary operators on the same level group to the left: `a - b - c` is
  `(a - b) - c`. `^` groups to the right and binds tighter than unary minus
  on its left: `2 ^ 3 ^ 2` is 512 and `-2 ^ 2` is -4. `?:` nests to the
  right.
- An `else` belongs to the nearest `if`.

A token that fits no rule is an error: `Expected <what>, found "<token>"`,
or `found end of file`, at that token.

## Values

Cases: `values/*`.

| Type     | Values                                                                     |
| -------- | -------------------------------------------------------------------------- |
| number   | IEEE 754 doubles, including infinity and NaN                               |
| string   | sequences of Unicode characters                                            |
| boolean  | `true` and `false`                                                         |
| undef    | the one value `undef`                                                      |
| list     | ordered sequences of values                                                |
| range    | a start, step and end number; `[a:b]` has step 1                           |
| function | a parameter list, a body expression and the scope the function was made in |

`type_of(v)` gives the type's name as above. Values cannot be changed
after they are made; every operation makes a new value.

Strings count, index and iterate by Unicode character (code point):
`len("😀")` is 1.

### Truth

In a condition (`if`, `?:`, `&&`, `||`, `!`, a comprehension's `if`,
`assert`), `false`, `0`, NaN, `""`, `[]` and `undef` are false. Every other
value is true, including `[0]`, `"0"`, ranges and functions.

### Equality

`a == b` is true when:

- both are numbers, strings or booleans of the same type and value (so
  `1 == "1"` and `0 == false` are false, and NaN is not equal to itself),
- both are `undef`,
- both are lists of the same length whose items are equal in order,
- both are ranges with the same start, step and end (`[0:2] == [0:1:2]`),
- or both are the same function value.

`a != b` is `!(a == b)`.

### Writing values

`echo()` and `str()` write values as text. A number is written as an
integer when it is one, and otherwise with up to 10 significant digits
(`1 / 3` is `0.3333333333`, `0.1 + 0.2` is `0.3`). Very large and small
numbers use exponent form (`1e+21`); infinities are `Infinity` and
`-Infinity`, NaN is `NaN`, and -0 is `0`. Lists are written as
`[a, b]`, ranges as `[start:step:end]`, functions as `function(a, b)` and
`undef` as `undef`. Strings are written as they are at the top level and in
double quotes, with escapes, inside a list or after a name.

## Expressions

Cases: `operators/*`, `lists/*`, `functions/*`.

### Arithmetic

| Operation        | Operands                          | Result                                                        |
| ---------------- | --------------------------------- | ------------------------------------------------------------- |
| `a + b`, `a - b` | numbers                           | sum, difference                                               |
|                  | two strings (`+` only)            | the strings joined                                            |
|                  | two lists of the same length      | item by item                                                  |
| `a * b`          | numbers                           | product                                                       |
|                  | list and number, either order     | each item times the number                                    |
|                  | two lists of numbers, same length | dot product                                                   |
|                  | matrix (list of rows) and list    | each row times the list                                       |
|                  | list and matrix                   | the list times each column; the matrix needs one row per item |
| `a / b`          | numbers; list and number          | quotient; each item divided by the number                     |
| `a % b`          | numbers                           | remainder, with the sign of `a` (`-7 % 3` is -1)              |
| `a ^ b`          | numbers                           | `a` to the power `b`                                          |
| `-a`             | number or list                    | `a * -1`                                                      |
| `+a`             | anything                          | `a` unchanged                                                 |

Arithmetic follows IEEE 754: `1 / 0` is infinity and `0 / 0` is NaN. Any
other combination of operands, including `undef`, booleans and lists of
different lengths, is an error at the operator: `Can't add boolean and
number`, `Can't add lists of length 2 and 3`.

### Comparison and logic

`<`, `<=`, `>` and `>=` compare two numbers, or two strings by UTF-16 code
unit (so `"B" < "a"`). Any other pair is an error: `Can't compare number <
string`. Comparisons give `true` or `false`; `1 < 2 < 3` compares the
boolean `true` with 3 and is an error.

`!a` is `true` when `a` is false and `false` otherwise. `a && b` and
`a || b` give `true` or `false`, never one of their operands, and skip `b`
when `a` decides the result, so `false && missing` is `false` without an
error.

`c ? a : b` evaluates only the chosen side.

### Names

A name in an expression is looked up in this order:

1. a variable of that name in the current scope or a scope around it
   (special variables follow the caller chain, see
   [Special variables](#special-variables));
2. a function definition of that name, which gives a function value;
3. for a name starting with `$`, `undef`;
4. otherwise the error `Unknown variable "name"`.

### Indexing and members

`a[i]` needs a number `i` (otherwise `List index must be a number, got
<type>`), rounded down. On a list it gives the item at that position from
0; on a string, the character; on a range, `[start, step, end][i]`. An
index outside the list, a negative index and an index into any other value
give `undef`.

`a.x`, `a.y` and `a.z` are `a[0]`, `a[1]` and `a[2]` on a list.
`r.begin`, `r.step` and `r.end` read a range. Any other member gives
`undef`.

### Calls

In `f(args)`, when `f` is a name:

1. If a variable named `f` is in scope, its value is called. A variable
   hides a function definition of the same name.
2. Otherwise a function definition named `f` is called.
3. Otherwise a built-in function named `f` is called.
4. Otherwise the error is `Unknown function f()`.

Calling a value that is not a function is an error: `"f" is a number, not a
function` for a name, `Can't call a number` otherwise.

Arguments are evaluated left to right in the caller's scope, then bound to
parameters:

- a named argument binds the parameter of that name;
- the remaining parameters take positional arguments in order;
- a parameter with neither takes its default, evaluated in the new scope
  so it can use the parameters before it, or `undef` without one;
- positional arguments beyond the parameters are ignored;
- a named argument that starts with `$` sets that special variable for the
  call; any other named argument that matches no parameter is ignored with
  the warning `f(): unknown argument "name" (line n)`.

A function call evaluates its body expression in a new scope whose parent
is the scope the function was defined or made in. A function value made
with `function (params) expr` keeps the scope it was made in and reads its
variables when it is called, so it sees later reassignments in that scope.

### Ranges

A range value is made by `[start:end]` or `[start:step:end]`; all three must
be numbers (`Range values must be numbers`). A range is not a list, but
`for`, `each` and comprehensions go through its values: `start`,
`start + step`, ... while not past `end`, with `end` included when it is
reached within 1e-9 of a step. The range is empty when the step is 0 or
points away from the end. A range with more values than the list limit is
an error when it is gone through.

### List comprehensions

Inside `[...]`, items produce zero or more values each:

- `expr` produces its value;
- `each expr` produces each value of a list, range or string, the value
  itself for any other value, and nothing for `undef`;
- `for (a = A, b = B) item` produces `item` for each value of `A`, and
  inside it for each value of `B`, with the names bound in a new scope;
- `if (c) item [else item]` produces the chosen item, or nothing;
- `let (a = 1, b = a + 1) item` binds names in order in a new scope.

`for` goes through a list, a range or the characters of a string. Any other
value is gone through once as itself, and `undef` not at all.

## Statements and scope

Cases: `scope/*`, `modules/*`.

### Evaluation

A program is a block. Evaluating a block:

1. Every `module` and `function` definition in the block is registered
   first, so it can be called anywhere in the block, also before it.
   `use` statements in the block are processed in this step too (see
   [Libraries](#libraries)). A later definition with the same name replaces
   an earlier one.
2. Then each statement runs in order.

A block has its own scope, created when the block starts. The bodies of
`if`, `else`, `for` (once per value), `let`, modules, `{ ... }` blocks and
module children each run in a new scope whose parent is the scope around
them.

### Assignment

`name = expr;` evaluates `expr` and binds `name` in the current scope from
that point on. A later assignment to the same name in the same scope
replaces the value for the statements after it. Reading a variable before
its first assignment is an error (`Unknown variable "name"`). An assignment
inside a block does not change a variable outside it.

Assignments at the top level of the program are its parameters. A renderer
can replace their values by name (render options `params`, `kerf render
-D`); the replaced assignment's expression is then not evaluated.

### Control statements

- `if (c) A else B` runs `A` when `c` is true, otherwise `B`.
- `for (a = A, b = B) body` runs the body for each value of `A`, and inside
  that for each value of `B`, like a comprehension.
- `let (a = 1, b = a + 1) body` binds names in order, then runs the body.

### Module calls

A statement `name(args) children` calls a module:

1. A module definition named `name` in scope runs its body in a new scope
   whose parent is the scope it was defined in, with the arguments bound
   like a function call's. `children()` inside it runs the call's child
   statements in the caller's scope; `children(i)` runs only the child
   statement at index `i` from 0 (an index outside them runs nothing);
   `$children` is the number of child statements that are not assignments
   or definitions.
2. Otherwise a built-in module named `name` runs.
3. Otherwise the error is `Unknown module name().`, with a hint for
   OpenSCAD's `color()` and `square()`.

A modifier changes the call: `*` skips it entirely, so its arguments and
children are not evaluated; `#` and `%` move all of its shapes to the
`guide` layer; `!` has no effect and is accepted for OpenSCAD files.

### Special variables

A name starting with `$` is a special variable. It is looked up through
the scopes of callers instead of the scopes around the definition: a module
or function sees the value its caller had, even when the caller set it after
the definition. Passing `$name = value` as an argument sets it for that
call. An unset special variable is `undef`.

These start with a value:

| Name         | Value        |
| ------------ | ------------ |
| `$fn`        | 0            |
| `$fa`        | 2            |
| `$fs`        | 0.2          |
| `$thickness` | 3            |
| `$kerf`      | 0            |
| `$material`  | `"material"` |
| `$sheet`     | `[600, 400]` |
| `$gap`       | 3            |
| `$layout`    | `"pack"`     |

`PI` is an ordinary variable set to π in the outermost scope.

## Libraries

Cases: `imports/*`.

`use <path>` and `include <path>` read another program, a library. The
renderer decides which text a path names: the built-in standard library
answers paths that start with `kerf/`, and the application supplies the
rest (the `resolve` render option; on the command line, the file `path` or
`path.kerf` in the design's folder). A path that names nothing is the error `Library <path> not
found`. Each path is read and parsed once per render.

`use <path>` makes the library's modules and functions available in the
block containing the `use`, from the start of that block:

- The library's top-level assignments are evaluated, in order, in a scope
  of its own whose parent is the block that uses it. Its functions and
  modules see those variables; the program does not.
- The library's other statements, including `echo()` and shapes, do not
  run.
- Files the library `include`s are part of the library, each once.
- Using the same library again has no further effect.

`include <path>` runs the library's statements in place, in the current
scope, as if its text were written there: its assignments, definitions and
shapes all take effect. Including a file twice runs it twice.

A library that uses or includes itself, directly or through others, is an
error at the statement that closes the loop: `Libraries use each other in a
loop: <a> → <b> → <a>`, or `Library <a> includes itself`. Positions inside a
library carry its path: `(line 1, column 1 in <a>)`.

## Errors

Cases: `errors/*`, and the errors in every other group.

An error stops the program. It has a message and, in nearly every case, a
position, written after the message as `(line L, column C)`, or `(line L,
column C in <path>)` inside a library. Output from `echo()` before the
error is kept and reported with it.

Errors come from:

- text that is not a program (see [Lexical structure](#lexical-structure)
  and [Syntax](#syntax));
- unknown names, calls of values that are not functions, and operations on
  the wrong types (see [Expressions](#expressions));
- `assert(condition, message)` with a false condition: `Assertion failed`,
  followed by `: message` when there is one;
- built-in modules and functions given unusable arguments;
- limits. A program from someone else can run in a browser, so these are
  enforced:

| Limit                                       | Default   | Message starts with                        |
| ------------------------------------------- | --------- | ------------------------------------------ |
| Statements, calls and loop steps            | 5,000,000 | `Stopped after N steps`                    |
| Nested module calls                         | 1,000     | `Recursion too deep in module name()`      |
| Nested function calls                       | 2,000     | `Recursion too deep`                       |
| Items in one list, characters in one string | 1,000,000 | `a list of N items` / `a range of N items` |
| Items in all lists and strings              | 3,000,000 | `The lists and strings hold more than`     |
| Points in all shapes                        | 2,000,000 | `The shapes have more than`                |

The [JavaScript API](javascript.md#running-untrusted-code) lists every
limit and how to change it.

A warning does not stop the program. Warnings are collected in order, each
message once, and returned with the output. Examples are unknown named
arguments and a program that makes no shapes.

## Output

Cases: `shapes/*`.

A program's shapes are 2D regions and lines, each on a layer (`cut` unless
placed on another), grouped into parts. The [language
reference](../LANGUAGE.md#layers) describes layers, parts, materials, kerf
compensation and sheet packing, and lists the built-in modules that make
shapes. Shapes outside every `part()` form one part named `part`.

## Known differences

These are behaviours of KerfScript 0.4 that this specification records as
they are, but that may change before language version 1.0:

- A function that calls itself without end can exhaust the interpreter's
  stack before the 2,000-call limit, giving `Recursion too deep: the
program calls itself without stopping` with no position.
- Built-in modules do not warn about unknown named arguments; user modules
  and functions do.
- Positional arguments beyond the parameters are ignored without a warning.
- `echo()` writes named arguments after the positional ones, whatever their
  order in the call.
- Errors in a call of a value that is not a function point at the `(` of
  the call rather than the name.
