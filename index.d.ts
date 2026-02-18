/* ────────────────────────────────────────────────────────────────
 *  lp‑model – TypeScript declaration file
 *
 *  The library can be used in three ways:
 *    • ES / CommonJS import:   import { Model, Var } from "lp-model";
 *    • Default import (require): const lp = require("lp-model");
 *    • Global script tag:      window.LPModel.Model …
 * ──────────────────────────────────────────────────────────────── */

/* --------------------------------------------------------------
 *  Public classes
 * -------------------------------------------------------------- */

export declare class Var {
  /** Lower bound – numeric value or the literal “-infinity”. */
  lb: number | "-infinity";

  /** Upper bound – numeric value, the literal “+infinity”, or `1` for binary variables. */
  ub: number | "+infinity";

  /** Variable type – always stored in upper‑case (`CONTINUOUS`, `BINARY`, `INTEGER`). */
  vtype: "CONTINUOUS" | "BINARY" | "INTEGER";

  /** Name of the variable (null ⇒ library will generate a unique name). */
  name: string | null;

  /** Value assigned by a solver after `solve()` (optional). */
  value?: number;

  /**
   * Construct a new decision variable.
   *
   * @param options Configuration object.
   *   - lb – lower bound (`0` by default, or “-infinity” for free below).
   *   - ub – upper bound (`"+infinity"` by default; forced to `1` when `vtype === "BINARY"`).
   *   - vtype – `"CONTINUOUS" | "BINARY" | "INTEGER"` (default `"CONTINUOUS"`).
   *   - name – optional explicit name.
   */
  constructor(options?: {
    lb?: number | "-infinity";
    ub?: number | "+infinity";
    vtype?: "CONTINUOUS" | "BINARY" | "INTEGER";
    name?: string | null;
  });
}

/* -------------------------------------------------------------- */

export declare class Constr {
  /** Left‑hand side expression (canonical form, see `Model.parseExpression`). */
  lhs: any[];

  /** Comparison operator – one of “<=”, “=”, or “>=”. */
  comparison: "<=" | "=" | ">=";

  /** Right‑hand side constant. */
  rhs: number;

  /** Primal value after solving (optional). */
  primal?: number;
  /** Dual value after solving (optional). */
  dual?: number;

  /**
   * Construct a new linear constraint.
   *
   * @param lhs        Left‑hand side expression.
   * @param comparison Comparison operator (`<=` | `=` | `>=`).
   * @param rhs        Right‑hand side constant.
   */
  constructor(lhs: any[], comparison: "<=" | "=" | ">=", rhs: number);
}

/* -------------------------------------------------------------- */

export declare class Model {
  /** Map of variable name → `Var` instance. */
  variables: Map<string, Var>;

  /** List of constraints added to the model. */
  constraints: Constr[];

  /**
   * Objective definition.
   *
   * - `expression[0]` is the constant term.
   * - Remaining items are linear (or quadratic) terms.
   */
  objective: { expression: any[]; sense: "MAXIMIZE" | "MINIMIZE" };

  /** Counter used for automatically generated variable names. */
  varCount: number;

  /** Raw solution object returned by a solver (if any). */
  solution: any | null;

  /** Human‑readable status (`"Optimal"`, `"Infeasible"` …). */
  status: string | null;

  /** Objective value of the optimal solution (null when not solved). */
  ObjVal: number | null;

  /* ------------------------------------------------------------------
   *  Model building helpers
   * ------------------------------------------------------------------ */

  /** Reset the model to an empty state. */
  clear(): void;

  /**
   * Add a single variable.
   *
   * @param options Same shape as the `Var` constructor options.
   * @returns The created `Var`.
   */
  addVar(options?: {
    lb?: number | "-infinity";
    ub?: number | "+infinity";
    vtype?: "CONTINUOUS" | "BINARY" | "INTEGER";
    name?: string;
  }): Var;

  /**
   * Add many variables that share the same options.
   *
   * @param varNames List of variable names to create.
   * @param options  Common options (same shape as `addVar`).
   * @returns An object mapping each supplied name to its `Var`.
   */
  addVars(
    varNames: string[],
    options?: {
      lb?: number | "-infinity";
      ub?: number | "+infinity";
      vtype?: "CONTINUOUS" | "BINARY" | "INTEGER";
    },
  ): { [name: string]: Var };

  /**
   * Define the objective function.
   *
   * @param expression Linear expression (see `parseExpression` for accepted formats).
   * @param sense      `"MAXIMIZE"` or `"MINIMIZE"`.
   */
  setObjective(expression: any[], sense: "MAXIMIZE" | "MINIMIZE"): void;

  /**
   * Add a linear constraint.
   *
   * @param lhs        Left‑hand side expression.
   * @param comparison One of `"<="`, `"="` or `">="`.
   * @param rhs        Right‑hand side – either a number or another linear expression.
   * @returns The created `Constr`.
   */
  addConstr(
    lhs: any[],
    comparison: "<=" | "=" | ">=",
    rhs: number | any[],
  ): Constr;

  /**
   * Parse a flexible linear expression into the library’s canonical form.
   *
   * Accepted items:
   *   - numbers (constants)
   *   - `Var` instances (`[1, var]` is added automatically)
   *   - `[coeff, Var]`
   *   - quadratic terms `[coeff, Var, Var]` (kept for completeness – not usable by all solvers)
   *
   * @param expression Raw expression array.
   * @returns Canonical expression (`[constant, [coeff,var], …]`).
   */
  parseExpression(expression: any[]): any[];

  /* ------------------------------------------------------------------
   *  Import / Export in CPLEX LP format
   * ------------------------------------------------------------------ */

  /** Serialize the model to a CPLEX‑compatible *.lp* string. */
  toLPFormat(): string;

  /**
   * Load an LP‑format string (full *.lp* file content, including the final `End` line).
   *
   * @param lpString The file contents.
   * @returns This model instance (allows chaining).
   */
  readLPFormat(lpString: string): Model;

  /** Returns true if any quadratic term is present in the objective or constraints. */
  isQuadratic(): boolean;

  /* ------------------------------------------------------------------
   *  Solver‑specific helpers
   * ------------------------------------------------------------------ */

  /** Apply a HiGHS.js solution object to this model. */
  readHighsSolution(solution: any): void;

  /** Convert the model to GLPK.js JSON format (throws if quadratic). */
  toGLPKFormat(): any;
  /** Apply a GLPK.js solution object to this model. */
  readGLPKSolution(solution: any): void;

  /**
   * Convert the model to jsLPSolver JSON format (throws if quadratic).
   *
   * @param options Optional solver‑specific options – they will be stored in the
   *                generated object under an `options` key.
   */
  toJSLPSolverFormat(options?: any): any;
  /** Apply a jsLPSolver solution object to this model. */
  readJSLPSolverSolution(solution: any): void;

  /**
   * Solve the model with one of the supported solvers (HiGHS.js, GLPK.js,
   * or jsLPSolver).  The function detects the solver type by checking for
   * characteristic methods/properties.
   *
   * @param solver  Solver instance (`highs`, `glpk`, or `jsLPSolver`‑like object).
   * @param options Optional solver‑specific options.
   */
  solve(solver: any, options?: any): Promise<void>;
}

/* --------------------------------------------------------------
 *  UMD global namespace – available when the script is loaded via
 *  a <script> tag (e.g. `<script src="lp-model.js"></script>`).
 *
 *  The global variable `LPModel` mirrors the ES‑module exports:
 *    LPModel.Var, LPModel.Constr, LPModel.Model
 * -------------------------------------------------------------- */
declare const LPModel: {
  Var: typeof Var;
  Constr: typeof Constr;
  Model: typeof Model;
};

export as namespace LPModel;

/* --------------------------------------------------------------
 *  Default export (CommonJS / UMD style)
 *
 *  Allows `const lp = require('lp-model');` or
 *          `import lp from 'lp-model';`
 * -------------------------------------------------------------- */
declare const _default: {
  Var: typeof Var;
  Constr: typeof Constr;
  Model: typeof Model;
};

export default _default;
