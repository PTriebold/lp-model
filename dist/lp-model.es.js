/* CONSTANTS */
// taken from https://github.com/jvail/glpk.js/blob/master/src/glpk.js
const glpk_consts = {};

/* direction: */
glpk_consts.GLP_MIN = 1;  /* minimization */
glpk_consts.GLP_MAX = 2;  /* maximization */

/* type of auxiliary/structural variable: */
glpk_consts.GLP_FR = 1;  /* free (unbounded) variable */
glpk_consts.GLP_LO = 2;  /* variable with lower bound */
glpk_consts.GLP_UP = 3;  /* variable with upper bound */
glpk_consts.GLP_DB = 4;  /* double-bounded variable */
glpk_consts.GLP_FX = 5;  /* fixed variable */

/* message level: */
glpk_consts.GLP_MSG_OFF = 0;   /* no output */
glpk_consts.GLP_MSG_ERR = 1;   /* warning and error messages only */
glpk_consts.GLP_MSG_ON = 2;    /* normal output */
glpk_consts.GLP_MSG_ALL = 3;   /* full output */
glpk_consts.GLP_MSG_DBG = 4;   /* debug output */

/* solution status: */
glpk_consts.GLP_UNDEF = 1;     /* solution is undefined */
glpk_consts.GLP_FEAS = 2;      /* solution is feasible */
glpk_consts.GLP_INFEAS = 3;    /* solution is infeasible */
glpk_consts.GLP_NOFEAS = 4;    /* no feasible solution exists */
glpk_consts.GLP_OPT = 5;	    /* solution is optimal */
glpk_consts.GLP_UNBND = 6;     /* solution is unbounded */

const solutionNames = {
    1: "Undefined",
    2: "Feasible",
    3: "Infeasible",
    4: "No feasible solution",
    5: "Optimal",
    6: "Unbounded"
};

function toGLPKFormat(model) {
    const glpkModel = {
        name: 'LP',
        objective: {
            direction: model.objective.sense.toUpperCase() === "MAXIMIZE" ? glpk_consts.GLP_MAX : glpk_consts.GLP_MIN,
            name: 'obj',
            vars: model.objective.expression.slice(1).map(term => ({ // Exclude constant term
                name: term[1].name,
                coef: term[0]
            }))
        },
        subjectTo: model.constraints.map((constr, index) => ({
            name: `cons${index + 1}`,
            vars: constr.lhs.slice(1).map(term => ({ // Exclude constant term
                name: term[1].name,
                coef: term[0]
            })),
            bnds: {
                type: constr.comparison === "<=" ? glpk_consts.GLP_UP : constr.comparison === ">=" ? glpk_consts.GLP_LO : glpk_consts.GLP_DB,
                ub: constr.comparison === "<=" ? constr.rhs : 0,
                lb: constr.comparison === ">=" ? constr.rhs : 0
            }
        })),
        bounds: Array.from(model.variables.values()).map(varObj => ({
            name: varObj.name,
            type: varObj.lb === "-infinity" ? (varObj.ub === "+infinity" ? glpk_consts.GLP_FR : glpk_consts.GLP_UP) :
                  varObj.ub === "+infinity" ? glpk_consts.GLP_LO : glpk_consts.GLP_DB,
            ub: varObj.ub === "+infinity" ? 0 : varObj.ub,
            lb: varObj.lb === "-infinity" ? 0 : varObj.lb
        })),
        binaries: Array.from(model.variables.values()).filter(varObj => varObj.vtype === "BINARY").map(varObj => varObj.name),
        generals: Array.from(model.variables.values()).filter(varObj => varObj.vtype === "INTEGER").map(varObj => varObj.name)
    };

    return glpkModel;
}

function readGLPKSolution(model, solution) {
    model.status = solutionNames[solution.result.status];
    model.ObjVal = solution.result.z + model.objective.expression[0]; // Add constant term to objective value

    // Update variable values
    Object.entries(solution.result.vars).forEach(([varName, varValue]) => {
        if (model.variables.has(varName)) {
            const variable = model.variables.get(varName);
            variable.value = varValue;
        } else {
            console.warn(`Variable ${varName} from the solution was not found in the model.`);
        }
    });

    // Optionally, update constraint dual values if available (for simplex solutions)
    if (solution.result.dual) {
        model.constraints.forEach((constraint, index) => {
            const dualValue = solution.result.dual[`cons${index + 1}`];
            if (dualValue !== undefined) {
                constraint.dual = dualValue;
            }
        });
    }
}

function toJSLPSolverFormat(model, options) {
    const jsLPModel = {
        optimize: "objective", // We'll use a generic name for the objective
        opType: model.objective.sense.toLowerCase().slice(0, 3), // Convert to "max" or "min"
        constraints: {},
        variables: {},
        ints: {},
        binaries: {},
        unrestricted: {},
        options: options
    };

    // Translate variables and handle bounds
    model.variables.forEach((varObj, varName) => {
        jsLPModel.variables[varName] = {}; // Initialize variable entry

        // Handle unrestricted variables (allowed to be negative)
        if (varObj.lb === "-infinity" || varObj.lb < 0) {
            jsLPModel.unrestricted[varName] = 1;
        }

        // If the variable has specific bounds, add virtual constraints
        if (varObj.lb !== 0 && varObj.lb !== "-infinity") {
            jsLPModel.constraints[`${varName}_lb`] = { min: varObj.lb };
        }
        if (varObj.ub !== "+infinity") {
            jsLPModel.constraints[`${varName}_ub`] = { max: varObj.ub };
        }

        // Mark binary and integer variables
        if (varObj.vtype === "BINARY") {
            jsLPModel.binaries[varName] = 1;
        } else if (varObj.vtype === "INTEGER") {
            jsLPModel.ints[varName] = 1;
        }
    });

    // Translate the objective function
    model.objective.expression.forEach(term => {
        if (Array.isArray(term)) { // Exclude constant term
            jsLPModel.variables[term[1].name]["objective"] = term[0];
        }
    });

    // Translate constraints
    model.constraints.forEach((constr, index) => {
        const constrName = `c${index}`;
        jsLPModel.constraints[constrName] = {};
        if (constr.comparison === "<=") {
            jsLPModel.constraints[constrName].max = constr.rhs;
        } else if (constr.comparison === ">=") {
            jsLPModel.constraints[constrName].min = constr.rhs;
        } else if (constr.comparison === "=") {
            jsLPModel.constraints[constrName].equal = constr.rhs;
        }
        constr.lhs.forEach(term => {
            if (Array.isArray(term)) {
                if (!(constrName in jsLPModel.variables[term[1].name])) {
                    jsLPModel.variables[term[1].name][constrName] = 0;
                }
                jsLPModel.variables[term[1].name][constrName] += term[0];
            }
        });
    });

    return jsLPModel;
}

function readJSLPSolverSolution(model, solution) {
    // example { feasible: true, result: 1080000, bounded: true, isIntegral: true, var1: 24, var2: 20 } and unmentioned variables are 0
    // console.log("readJSLPSolverSolution", solution);
    model.status = solution.feasible ? (solution.bounded ? "Optimal" : "Unbounded") : "Infeasible";

    // Update variable values
    model.variables.forEach((varObj, varName) => {
        if (varName in solution) {
            varObj.value = solution[varName];
        } else {
            varObj.value = 0;
        }
    });

    // Update objective value
    if (solution.result) {
        model.ObjVal = solution.result + model.objective.expression[0]; // Add constant term to objective value
    }
}

function readHighsSolution(model, solution) {
    model.status = solution.Status;

    if (solution.Status !== 'Optimal' && solution.Status !== 'Feasible') {
        return; // Do not update variable values if the solution is not optimal or feasible
    }

    // Update variable values
    Object.entries(solution.Columns).forEach(([name, column]) => {
        if (model.variables.has(name)) {
            const variable = model.variables.get(name);
            variable.value = column.Primal; // Set variable's value to its primal value from the solution
        } else {
            console.warn(`Variable ${name} from the solution was not found in the model.`);
        }
    });

    // Update constraint primal and dual values
    solution.Rows.forEach((row, index) => {
        if (index < model.constraints.length) {
            const constraint = model.constraints[index];
            constraint.primal = row.Primal; // Set constraint's primal value
            constraint.dual = row.Dual; // Set constraint's dual value
        } else {
            console.warn(`Row ${row.Name} from the solution does not correspond to any model constraint.`);
        }
    });

    // Update objective value
    if (solution.ObjectiveValue) {
        model.ObjVal = solution.ObjectiveValue;
    }
}

// @generated by Peggy 4.0.0.
//
// https://peggyjs.org/


function peg$subclass(child, parent) {
  function C() { this.constructor = child; }
  C.prototype = parent.prototype;
  child.prototype = new C();
}

function peg$SyntaxError(message, expected, found, location) {
  var self = Error.call(this, message);
  // istanbul ignore next Check is a necessary evil to support older environments
  if (Object.setPrototypeOf) {
    Object.setPrototypeOf(self, peg$SyntaxError.prototype);
  }
  self.expected = expected;
  self.found = found;
  self.location = location;
  self.name = "SyntaxError";
  return self;
}

peg$subclass(peg$SyntaxError, Error);

function peg$padEnd(str, targetLength, padString) {
  padString = padString || " ";
  if (str.length > targetLength) { return str; }
  targetLength -= str.length;
  padString += padString.repeat(targetLength);
  return str + padString.slice(0, targetLength);
}

peg$SyntaxError.prototype.format = function(sources) {
  var str = "Error: " + this.message;
  if (this.location) {
    var src = null;
    var k;
    for (k = 0; k < sources.length; k++) {
      if (sources[k].source === this.location.source) {
        src = sources[k].text.split(/\r\n|\n|\r/g);
        break;
      }
    }
    var s = this.location.start;
    var offset_s = (this.location.source && (typeof this.location.source.offset === "function"))
      ? this.location.source.offset(s)
      : s;
    var loc = this.location.source + ":" + offset_s.line + ":" + offset_s.column;
    if (src) {
      var e = this.location.end;
      var filler = peg$padEnd("", offset_s.line.toString().length, ' ');
      var line = src[s.line - 1];
      var last = s.line === e.line ? e.column : line.length + 1;
      var hatLen = (last - s.column) || 1;
      str += "\n --> " + loc + "\n"
          + filler + " |\n"
          + offset_s.line + " | " + line + "\n"
          + filler + " | " + peg$padEnd("", s.column - 1, ' ')
          + peg$padEnd("", hatLen, "^");
    } else {
      str += "\n at " + loc;
    }
  }
  return str;
};

peg$SyntaxError.buildMessage = function(expected, found) {
  var DESCRIBE_EXPECTATION_FNS = {
    literal: function(expectation) {
      return "\"" + literalEscape(expectation.text) + "\"";
    },

    class: function(expectation) {
      var escapedParts = expectation.parts.map(function(part) {
        return Array.isArray(part)
          ? classEscape(part[0]) + "-" + classEscape(part[1])
          : classEscape(part);
      });

      return "[" + (expectation.inverted ? "^" : "") + escapedParts.join("") + "]";
    },

    any: function() {
      return "any character";
    },

    end: function() {
      return "end of input";
    },

    other: function(expectation) {
      return expectation.description;
    }
  };

  function hex(ch) {
    return ch.charCodeAt(0).toString(16).toUpperCase();
  }

  function literalEscape(s) {
    return s
      .replace(/\\/g, "\\\\")
      .replace(/"/g,  "\\\"")
      .replace(/\0/g, "\\0")
      .replace(/\t/g, "\\t")
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")
      .replace(/[\x00-\x0F]/g,          function(ch) { return "\\x0" + hex(ch); })
      .replace(/[\x10-\x1F\x7F-\x9F]/g, function(ch) { return "\\x"  + hex(ch); });
  }

  function classEscape(s) {
    return s
      .replace(/\\/g, "\\\\")
      .replace(/\]/g, "\\]")
      .replace(/\^/g, "\\^")
      .replace(/-/g,  "\\-")
      .replace(/\0/g, "\\0")
      .replace(/\t/g, "\\t")
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")
      .replace(/[\x00-\x0F]/g,          function(ch) { return "\\x0" + hex(ch); })
      .replace(/[\x10-\x1F\x7F-\x9F]/g, function(ch) { return "\\x"  + hex(ch); });
  }

  function describeExpectation(expectation) {
    return DESCRIBE_EXPECTATION_FNS[expectation.type](expectation);
  }

  function describeExpected(expected) {
    var descriptions = expected.map(describeExpectation);
    var i, j;

    descriptions.sort();

    if (descriptions.length > 0) {
      for (i = 1, j = 1; i < descriptions.length; i++) {
        if (descriptions[i - 1] !== descriptions[i]) {
          descriptions[j] = descriptions[i];
          j++;
        }
      }
      descriptions.length = j;
    }

    switch (descriptions.length) {
      case 1:
        return descriptions[0];

      case 2:
        return descriptions[0] + " or " + descriptions[1];

      default:
        return descriptions.slice(0, -1).join(", ")
          + ", or "
          + descriptions[descriptions.length - 1];
    }
  }

  function describeFound(found) {
    return found ? "\"" + literalEscape(found) + "\"" : "end of input";
  }

  return "Expected " + describeExpected(expected) + " but " + describeFound(found) + " found.";
};

function peg$parse(input, options) {
  options = options !== undefined ? options : {};

  var peg$FAILED = {};
  var peg$source = options.grammarSource;

  var peg$startRuleFunctions = { LPFile: peg$parseLPFile };
  var peg$startRuleFunction = peg$parseLPFile;

  var peg$c0 = "end";
  var peg$c1 = "maximize";
  var peg$c2 = "minimize";
  var peg$c3 = "max";
  var peg$c4 = "min";
  var peg$c5 = ":";
  var peg$c6 = "subject to";
  var peg$c7 = "st";
  var peg$c8 = "s.t.";
  var peg$c9 = "<=";
  var peg$c10 = ">=";
  var peg$c11 = "=";
  var peg$c12 = "=<";
  var peg$c13 = "=>";
  var peg$c14 = "<";
  var peg$c15 = "bounds";
  var peg$c16 = "free";
  var peg$c17 = "-infinity";
  var peg$c18 = "+infinity";
  var peg$c19 = "-inf";
  var peg$c20 = "+inf";
  var peg$c21 = "binary";
  var peg$c22 = "binaries";
  var peg$c23 = "bin";
  var peg$c24 = "generals";
  var peg$c25 = "general";
  var peg$c26 = "gen";
  var peg$c27 = ".";
  var peg$c28 = "e";
  var peg$c29 = "\\";
  var peg$c30 = "\n";

  var peg$r0 = /^[+\-]/;
  var peg$r1 = /^[a-zA-Z!"#$%&'()*+,.\/;?@_`'{|}~]/;
  var peg$r2 = /^[a-zA-Z0-9!"#$%&'()*+,.\/;?@_`'{|}~]/;
  var peg$r3 = /^[0-9]/;
  var peg$r4 = /^[ \t\n\r]/;
  var peg$r5 = /^[^\n]/;

  var peg$e0 = peg$literalExpectation("End", true);
  var peg$e1 = peg$literalExpectation("Maximize", true);
  var peg$e2 = peg$literalExpectation("Minimize", true);
  var peg$e3 = peg$literalExpectation("MAX", true);
  var peg$e4 = peg$literalExpectation("MIN", true);
  var peg$e5 = peg$literalExpectation(":", false);
  var peg$e6 = peg$literalExpectation("Subject To", true);
  var peg$e7 = peg$literalExpectation("ST", true);
  var peg$e8 = peg$literalExpectation("S.T.", true);
  var peg$e9 = peg$literalExpectation("<=", false);
  var peg$e10 = peg$literalExpectation(">=", false);
  var peg$e11 = peg$literalExpectation("=", false);
  var peg$e12 = peg$literalExpectation("=<", false);
  var peg$e13 = peg$literalExpectation("=>", false);
  var peg$e14 = peg$literalExpectation("<", false);
  var peg$e15 = peg$literalExpectation("Bounds", true);
  var peg$e16 = peg$literalExpectation("free", true);
  var peg$e17 = peg$otherExpectation("infinity number");
  var peg$e18 = peg$literalExpectation("-infinity", true);
  var peg$e19 = peg$literalExpectation("+infinity", true);
  var peg$e20 = peg$literalExpectation("-inf", true);
  var peg$e21 = peg$literalExpectation("+inf", true);
  var peg$e22 = peg$literalExpectation("Binary", true);
  var peg$e23 = peg$literalExpectation("Binaries", true);
  var peg$e24 = peg$literalExpectation("Bin", true);
  var peg$e25 = peg$literalExpectation("Generals", true);
  var peg$e26 = peg$literalExpectation("General", true);
  var peg$e27 = peg$literalExpectation("Gen", true);
  var peg$e28 = peg$classExpectation(["+", "-"], false, false);
  var peg$e29 = peg$otherExpectation("variable name");
  var peg$e30 = peg$classExpectation([["a", "z"], ["A", "Z"], "!", "\"", "#", "$", "%", "&", "'", "(", ")", "*", "+", ",", ".", "/", ";", "?", "@", "_", "`", "'", "{", "|", "}", "~"], false, false);
  var peg$e31 = peg$classExpectation([["a", "z"], ["A", "Z"], ["0", "9"], "!", "\"", "#", "$", "%", "&", "'", "(", ")", "*", "+", ",", ".", "/", ";", "?", "@", "_", "`", "'", "{", "|", "}", "~"], false, false);
  var peg$e32 = peg$otherExpectation("signed number");
  var peg$e33 = peg$otherExpectation("number");
  var peg$e34 = peg$classExpectation([["0", "9"]], false, false);
  var peg$e35 = peg$literalExpectation(".", false);
  var peg$e36 = peg$literalExpectation("e", true);
  var peg$e37 = peg$otherExpectation("whitespace or comment");
  var peg$e38 = peg$classExpectation([" ", "\t", "\n", "\r"], false, false);
  var peg$e39 = peg$literalExpectation("\\", false);
  var peg$e40 = peg$classExpectation(["\n"], true, false);
  var peg$e41 = peg$literalExpectation("\n", false);

  var peg$f0 = function(header, constraints, bounds, general, binary) {
    return {
      objective: header,
      constraints: constraints ? constraints : [],
      bounds: bounds ? bounds : [],
      general: general ? general : [],
      binary: binary ? binary : []
    };
  };
  var peg$f1 = function(objectiveType, name, expr) {
    return {
      type: objectiveType.toLowerCase().startsWith('max') ? 'max' : 'min',
      name: name ? name[0] : null,
      expression: expr
    };
  };
  var peg$f2 = function(constraints) {
    return constraints;
  };
  var peg$f3 = function(name, expr, sense, value) {
    return {
      name: name ? name[0] : null,
      expression: expr,
      sense: sense,
      value: value
    };
  };
  var peg$f4 = function() { return text() === '<' ? '<=' : text() === '>' ? '>=' : text(); };
  var peg$f5 = function(bounds) {
    return bounds;
  };
  var peg$f6 = function(variable) { // Handle 'free' variables
      return { variable: variable, range: "free" };
    };
  var peg$f7 = function(lower, variable, upper) { // Full range bounds with support for infinity
      return { variable: variable, lower: lower, upper: upper };
    };
  var peg$f8 = function(variable, upper) { // Upper bound only with support for infinity
      return { variable: variable, upper: upper };
    };
  var peg$f9 = function(lower, variable) { // Lower bound only with support for infinity
      return { variable: variable, lower: lower };
    };
  var peg$f10 = function(infinity) { 
    return infinity.startsWith('-') ? "-infinity" : "+infinity";
    };
  var peg$f11 = function(vars) {
	  return vars.map(v => v[0]); 
  };
  var peg$f12 = function(vars) {
	  return vars.map(v => v[0]); 
  };
  var peg$f13 = function(first, rest) {
      let terms = [first];
      for (let r of rest) {
        let sign = r[1];
        let term = r[3];
        if (sign === '-') {
          term.coefficient = -term.coefficient;
        }
        terms.push(term);
      }
      return terms;
    };
  var peg$f14 = function(sign, term) {
      term.coefficient = (sign === '+' ? 1 : -1) * Math.abs(term.coefficient);
      return term;
    };
  var peg$f15 = function(coefficient, variable) {
      return { coefficient: coefficient, variable: variable };
    };
  var peg$f16 = function(variable) {
      return { coefficient: 1, variable: variable };
    };
  var peg$f17 = function(number) {
      return { coefficient: number, variable: null };
    };
  var peg$f18 = function() {
    return text();
  };
  var peg$f19 = function() {
    return parseFloat(text());
  };
  var peg$f20 = function(number) {
    return parseFloat(text());
  };
  var peg$currPos = options.peg$currPos | 0;
  var peg$savedPos = peg$currPos;
  var peg$posDetailsCache = [{ line: 1, column: 1 }];
  var peg$maxFailPos = peg$currPos;
  var peg$maxFailExpected = options.peg$maxFailExpected || [];
  var peg$silentFails = options.peg$silentFails | 0;

  var peg$result;

  if (options.startRule) {
    if (!(options.startRule in peg$startRuleFunctions)) {
      throw new Error("Can't start parsing from rule \"" + options.startRule + "\".");
    }

    peg$startRuleFunction = peg$startRuleFunctions[options.startRule];
  }

  function text() {
    return input.substring(peg$savedPos, peg$currPos);
  }

  function peg$literalExpectation(text, ignoreCase) {
    return { type: "literal", text: text, ignoreCase: ignoreCase };
  }

  function peg$classExpectation(parts, inverted, ignoreCase) {
    return { type: "class", parts: parts, inverted: inverted, ignoreCase: ignoreCase };
  }

  function peg$endExpectation() {
    return { type: "end" };
  }

  function peg$otherExpectation(description) {
    return { type: "other", description: description };
  }

  function peg$computePosDetails(pos) {
    var details = peg$posDetailsCache[pos];
    var p;

    if (details) {
      return details;
    } else {
      if (pos >= peg$posDetailsCache.length) {
        p = peg$posDetailsCache.length - 1;
      } else {
        p = pos;
        while (!peg$posDetailsCache[--p]) {}
      }

      details = peg$posDetailsCache[p];
      details = {
        line: details.line,
        column: details.column
      };

      while (p < pos) {
        if (input.charCodeAt(p) === 10) {
          details.line++;
          details.column = 1;
        } else {
          details.column++;
        }

        p++;
      }

      peg$posDetailsCache[pos] = details;

      return details;
    }
  }

  function peg$computeLocation(startPos, endPos, offset) {
    var startPosDetails = peg$computePosDetails(startPos);
    var endPosDetails = peg$computePosDetails(endPos);

    var res = {
      source: peg$source,
      start: {
        offset: startPos,
        line: startPosDetails.line,
        column: startPosDetails.column
      },
      end: {
        offset: endPos,
        line: endPosDetails.line,
        column: endPosDetails.column
      }
    };
    if (offset && peg$source && (typeof peg$source.offset === "function")) {
      res.start = peg$source.offset(res.start);
      res.end = peg$source.offset(res.end);
    }
    return res;
  }

  function peg$fail(expected) {
    if (peg$currPos < peg$maxFailPos) { return; }

    if (peg$currPos > peg$maxFailPos) {
      peg$maxFailPos = peg$currPos;
      peg$maxFailExpected = [];
    }

    peg$maxFailExpected.push(expected);
  }

  function peg$buildStructuredError(expected, found, location) {
    return new peg$SyntaxError(
      peg$SyntaxError.buildMessage(expected, found),
      expected,
      found,
      location
    );
  }

  function peg$parseLPFile() {
    var s0, s2, s4, s6, s8, s10, s12;

    s0 = peg$currPos;
    peg$parse_();
    s2 = peg$parseObjective();
    if (s2 !== peg$FAILED) {
      peg$parse_();
      s4 = peg$parseConstraints();
      if (s4 !== peg$FAILED) {
        peg$parse_();
        s6 = peg$parseBounds();
        if (s6 === peg$FAILED) {
          s6 = null;
        }
        peg$parse_();
        s8 = peg$parseGeneral();
        if (s8 === peg$FAILED) {
          s8 = null;
        }
        peg$parse_();
        s10 = peg$parseBinary();
        if (s10 === peg$FAILED) {
          s10 = null;
        }
        peg$parse_();
        s12 = input.substr(peg$currPos, 3);
        if (s12.toLowerCase() === peg$c0) {
          peg$currPos += 3;
        } else {
          s12 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$e0); }
        }
        if (s12 !== peg$FAILED) {
          peg$parse_();
          peg$savedPos = s0;
          s0 = peg$f0(s2, s4, s6, s8, s10);
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseObjective() {
    var s0, s1, s3, s4, s5;

    s0 = peg$currPos;
    s1 = input.substr(peg$currPos, 8);
    if (s1.toLowerCase() === peg$c1) {
      peg$currPos += 8;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$e1); }
    }
    if (s1 === peg$FAILED) {
      s1 = input.substr(peg$currPos, 8);
      if (s1.toLowerCase() === peg$c2) {
        peg$currPos += 8;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$e2); }
      }
      if (s1 === peg$FAILED) {
        s1 = input.substr(peg$currPos, 3);
        if (s1.toLowerCase() === peg$c3) {
          peg$currPos += 3;
        } else {
          s1 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$e3); }
        }
        if (s1 === peg$FAILED) {
          s1 = input.substr(peg$currPos, 3);
          if (s1.toLowerCase() === peg$c4) {
            peg$currPos += 3;
          } else {
            s1 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$e4); }
          }
        }
      }
    }
    if (s1 !== peg$FAILED) {
      peg$parse_();
      s3 = peg$currPos;
      s4 = peg$parseVariableName();
      if (s4 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 58) {
          s5 = peg$c5;
          peg$currPos++;
        } else {
          s5 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$e5); }
        }
        if (s5 !== peg$FAILED) {
          s4 = [s4, s5];
          s3 = s4;
        } else {
          peg$currPos = s3;
          s3 = peg$FAILED;
        }
      } else {
        peg$currPos = s3;
        s3 = peg$FAILED;
      }
      if (s3 === peg$FAILED) {
        s3 = null;
      }
      s4 = peg$parse_();
      s5 = peg$parseExpression();
      if (s5 !== peg$FAILED) {
        peg$savedPos = s0;
        s0 = peg$f1(s1, s3, s5);
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseConstraints() {
    var s0, s1, s3, s4;

    s0 = peg$currPos;
    s1 = input.substr(peg$currPos, 10);
    if (s1.toLowerCase() === peg$c6) {
      peg$currPos += 10;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$e6); }
    }
    if (s1 === peg$FAILED) {
      s1 = input.substr(peg$currPos, 2);
      if (s1.toLowerCase() === peg$c7) {
        peg$currPos += 2;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$e7); }
      }
      if (s1 === peg$FAILED) {
        s1 = input.substr(peg$currPos, 4);
        if (s1.toLowerCase() === peg$c8) {
          peg$currPos += 4;
        } else {
          s1 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$e8); }
        }
      }
    }
    if (s1 !== peg$FAILED) {
      peg$parse_();
      s3 = [];
      s4 = peg$parseConstraint();
      if (s4 !== peg$FAILED) {
        while (s4 !== peg$FAILED) {
          s3.push(s4);
          s4 = peg$parseConstraint();
        }
      } else {
        s3 = peg$FAILED;
      }
      if (s3 !== peg$FAILED) {
        peg$savedPos = s0;
        s0 = peg$f2(s3);
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseConstraint() {
    var s0, s1, s2, s3, s5, s7;

    s0 = peg$currPos;
    s1 = peg$currPos;
    s2 = peg$parseVariableName();
    if (s2 !== peg$FAILED) {
      if (input.charCodeAt(peg$currPos) === 58) {
        s3 = peg$c5;
        peg$currPos++;
      } else {
        s3 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$e5); }
      }
      if (s3 !== peg$FAILED) {
        s2 = [s2, s3];
        s1 = s2;
      } else {
        peg$currPos = s1;
        s1 = peg$FAILED;
      }
    } else {
      peg$currPos = s1;
      s1 = peg$FAILED;
    }
    if (s1 === peg$FAILED) {
      s1 = null;
    }
    s2 = peg$parse_();
    s3 = peg$parseExpression();
    if (s3 !== peg$FAILED) {
      peg$parse_();
      s5 = peg$parseConstraintSense();
      if (s5 !== peg$FAILED) {
        peg$parse_();
        s7 = peg$parseSignedNumber();
        if (s7 !== peg$FAILED) {
          peg$parse_();
          peg$savedPos = s0;
          s0 = peg$f3(s1, s3, s5, s7);
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseConstraintSense() {
    var s0, s1;

    if (input.substr(peg$currPos, 2) === peg$c9) {
      s0 = peg$c9;
      peg$currPos += 2;
    } else {
      s0 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$e9); }
    }
    if (s0 === peg$FAILED) {
      if (input.substr(peg$currPos, 2) === peg$c10) {
        s0 = peg$c10;
        peg$currPos += 2;
      } else {
        s0 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$e10); }
      }
      if (s0 === peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 61) {
          s0 = peg$c11;
          peg$currPos++;
        } else {
          s0 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$e11); }
        }
        if (s0 === peg$FAILED) {
          if (input.substr(peg$currPos, 2) === peg$c12) {
            s0 = peg$c12;
            peg$currPos += 2;
          } else {
            s0 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$e12); }
          }
          if (s0 === peg$FAILED) {
            if (input.substr(peg$currPos, 2) === peg$c13) {
              s0 = peg$c13;
              peg$currPos += 2;
            } else {
              s0 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$e13); }
            }
            if (s0 === peg$FAILED) {
              s0 = peg$currPos;
              if (input.charCodeAt(peg$currPos) === 60) {
                s1 = peg$c14;
                peg$currPos++;
              } else {
                s1 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$e14); }
              }
              if (s1 !== peg$FAILED) {
                peg$savedPos = s0;
                s1 = peg$f4();
              }
              s0 = s1;
            }
          }
        }
      }
    }

    return s0;
  }

  function peg$parseBounds() {
    var s0, s1, s3, s4;

    s0 = peg$currPos;
    s1 = input.substr(peg$currPos, 6);
    if (s1.toLowerCase() === peg$c15) {
      peg$currPos += 6;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$e15); }
    }
    if (s1 !== peg$FAILED) {
      peg$parse_();
      s3 = [];
      s4 = peg$parseBound();
      if (s4 !== peg$FAILED) {
        while (s4 !== peg$FAILED) {
          s3.push(s4);
          s4 = peg$parseBound();
        }
      } else {
        s3 = peg$FAILED;
      }
      if (s3 !== peg$FAILED) {
        peg$savedPos = s0;
        s0 = peg$f5(s3);
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseBound() {
    var s0, s1, s3, s5, s7, s9;

    s0 = peg$currPos;
    s1 = peg$parseVariableName();
    if (s1 !== peg$FAILED) {
      peg$parse_();
      s3 = input.substr(peg$currPos, 4);
      if (s3.toLowerCase() === peg$c16) {
        peg$currPos += 4;
      } else {
        s3 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$e16); }
      }
      if (s3 !== peg$FAILED) {
        peg$parse_();
        peg$savedPos = s0;
        s0 = peg$f6(s1);
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    if (s0 === peg$FAILED) {
      s0 = peg$currPos;
      s1 = peg$parseInfinityNumber();
      if (s1 !== peg$FAILED) {
        peg$parse_();
        if (input.substr(peg$currPos, 2) === peg$c9) {
          s3 = peg$c9;
          peg$currPos += 2;
        } else {
          s3 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$e9); }
        }
        if (s3 !== peg$FAILED) {
          peg$parse_();
          s5 = peg$parseVariableName();
          if (s5 !== peg$FAILED) {
            peg$parse_();
            if (input.substr(peg$currPos, 2) === peg$c9) {
              s7 = peg$c9;
              peg$currPos += 2;
            } else {
              s7 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$e9); }
            }
            if (s7 !== peg$FAILED) {
              peg$parse_();
              s9 = peg$parseInfinityNumber();
              if (s9 !== peg$FAILED) {
                peg$parse_();
                peg$savedPos = s0;
                s0 = peg$f7(s1, s5, s9);
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
      if (s0 === peg$FAILED) {
        s0 = peg$currPos;
        s1 = peg$parseVariableName();
        if (s1 !== peg$FAILED) {
          peg$parse_();
          if (input.substr(peg$currPos, 2) === peg$c9) {
            s3 = peg$c9;
            peg$currPos += 2;
          } else {
            s3 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$e9); }
          }
          if (s3 !== peg$FAILED) {
            peg$parse_();
            s5 = peg$parseInfinityNumber();
            if (s5 !== peg$FAILED) {
              peg$parse_();
              peg$savedPos = s0;
              s0 = peg$f8(s1, s5);
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
        if (s0 === peg$FAILED) {
          s0 = peg$currPos;
          s1 = peg$parseInfinityNumber();
          if (s1 !== peg$FAILED) {
            peg$parse_();
            if (input.substr(peg$currPos, 2) === peg$c9) {
              s3 = peg$c9;
              peg$currPos += 2;
            } else {
              s3 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$e9); }
            }
            if (s3 !== peg$FAILED) {
              peg$parse_();
              s5 = peg$parseVariableName();
              if (s5 !== peg$FAILED) {
                peg$parse_();
                peg$savedPos = s0;
                s0 = peg$f9(s1, s5);
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        }
      }
    }

    return s0;
  }

  function peg$parseInfinityNumber() {
    var s0, s1;

    peg$silentFails++;
    s0 = peg$currPos;
    s1 = input.substr(peg$currPos, 9);
    if (s1.toLowerCase() === peg$c17) {
      peg$currPos += 9;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$e18); }
    }
    if (s1 === peg$FAILED) {
      s1 = input.substr(peg$currPos, 9);
      if (s1.toLowerCase() === peg$c18) {
        peg$currPos += 9;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$e19); }
      }
      if (s1 === peg$FAILED) {
        s1 = input.substr(peg$currPos, 4);
        if (s1.toLowerCase() === peg$c19) {
          peg$currPos += 4;
        } else {
          s1 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$e20); }
        }
        if (s1 === peg$FAILED) {
          s1 = input.substr(peg$currPos, 4);
          if (s1.toLowerCase() === peg$c20) {
            peg$currPos += 4;
          } else {
            s1 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$e21); }
          }
        }
      }
    }
    if (s1 !== peg$FAILED) {
      peg$savedPos = s0;
      s1 = peg$f10(s1);
    }
    s0 = s1;
    if (s0 === peg$FAILED) {
      s0 = peg$parseSignedNumber();
    }
    peg$silentFails--;
    if (s0 === peg$FAILED) {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$e17); }
    }

    return s0;
  }

  function peg$parseBinaryHeader() {
    var s0;

    s0 = input.substr(peg$currPos, 6);
    if (s0.toLowerCase() === peg$c21) {
      peg$currPos += 6;
    } else {
      s0 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$e22); }
    }
    if (s0 === peg$FAILED) {
      s0 = input.substr(peg$currPos, 8);
      if (s0.toLowerCase() === peg$c22) {
        peg$currPos += 8;
      } else {
        s0 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$e23); }
      }
      if (s0 === peg$FAILED) {
        s0 = input.substr(peg$currPos, 3);
        if (s0.toLowerCase() === peg$c23) {
          peg$currPos += 3;
        } else {
          s0 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$e24); }
        }
      }
    }

    return s0;
  }

  function peg$parseGeneralHeader() {
    var s0;

    s0 = input.substr(peg$currPos, 8);
    if (s0.toLowerCase() === peg$c24) {
      peg$currPos += 8;
    } else {
      s0 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$e25); }
    }
    if (s0 === peg$FAILED) {
      s0 = input.substr(peg$currPos, 7);
      if (s0.toLowerCase() === peg$c25) {
        peg$currPos += 7;
      } else {
        s0 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$e26); }
      }
      if (s0 === peg$FAILED) {
        s0 = input.substr(peg$currPos, 3);
        if (s0.toLowerCase() === peg$c26) {
          peg$currPos += 3;
        } else {
          s0 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$e27); }
        }
      }
    }

    return s0;
  }

  function peg$parseGeneral() {
    var s0, s1, s3, s4, s5, s6;

    s0 = peg$currPos;
    s1 = peg$parseGeneralHeader();
    if (s1 !== peg$FAILED) {
      peg$parse_();
      s3 = [];
      s4 = peg$currPos;
      s5 = peg$parseVariableName();
      if (s5 !== peg$FAILED) {
        s6 = peg$parse_();
        s5 = [s5, s6];
        s4 = s5;
      } else {
        peg$currPos = s4;
        s4 = peg$FAILED;
      }
      if (s4 !== peg$FAILED) {
        while (s4 !== peg$FAILED) {
          s3.push(s4);
          s4 = peg$currPos;
          s5 = peg$parseVariableName();
          if (s5 !== peg$FAILED) {
            s6 = peg$parse_();
            s5 = [s5, s6];
            s4 = s5;
          } else {
            peg$currPos = s4;
            s4 = peg$FAILED;
          }
        }
      } else {
        s3 = peg$FAILED;
      }
      if (s3 !== peg$FAILED) {
        peg$savedPos = s0;
        s0 = peg$f11(s3);
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseBinary() {
    var s0, s1, s3, s4, s5, s6;

    s0 = peg$currPos;
    s1 = peg$parseBinaryHeader();
    if (s1 !== peg$FAILED) {
      peg$parse_();
      s3 = [];
      s4 = peg$currPos;
      s5 = peg$parseVariableName();
      if (s5 !== peg$FAILED) {
        s6 = peg$parse_();
        s5 = [s5, s6];
        s4 = s5;
      } else {
        peg$currPos = s4;
        s4 = peg$FAILED;
      }
      if (s4 !== peg$FAILED) {
        while (s4 !== peg$FAILED) {
          s3.push(s4);
          s4 = peg$currPos;
          s5 = peg$parseVariableName();
          if (s5 !== peg$FAILED) {
            s6 = peg$parse_();
            s5 = [s5, s6];
            s4 = s5;
          } else {
            peg$currPos = s4;
            s4 = peg$FAILED;
          }
        }
      } else {
        s3 = peg$FAILED;
      }
      if (s3 !== peg$FAILED) {
        peg$savedPos = s0;
        s0 = peg$f12(s3);
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseExpression() {
    var s0, s1, s2, s3, s4, s5, s6, s7;

    s0 = peg$currPos;
    s1 = peg$parseTermWithSign();
    if (s1 === peg$FAILED) {
      s1 = peg$parseTerm();
    }
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$currPos;
      s4 = peg$parse_();
      s5 = input.charAt(peg$currPos);
      if (peg$r0.test(s5)) {
        peg$currPos++;
      } else {
        s5 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$e28); }
      }
      if (s5 !== peg$FAILED) {
        s6 = peg$parse_();
        s7 = peg$parseTermWithSign();
        if (s7 === peg$FAILED) {
          s7 = peg$parseTerm();
        }
        if (s7 !== peg$FAILED) {
          s4 = [s4, s5, s6, s7];
          s3 = s4;
        } else {
          peg$currPos = s3;
          s3 = peg$FAILED;
        }
      } else {
        peg$currPos = s3;
        s3 = peg$FAILED;
      }
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$currPos;
        s4 = peg$parse_();
        s5 = input.charAt(peg$currPos);
        if (peg$r0.test(s5)) {
          peg$currPos++;
        } else {
          s5 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$e28); }
        }
        if (s5 !== peg$FAILED) {
          s6 = peg$parse_();
          s7 = peg$parseTermWithSign();
          if (s7 === peg$FAILED) {
            s7 = peg$parseTerm();
          }
          if (s7 !== peg$FAILED) {
            s4 = [s4, s5, s6, s7];
            s3 = s4;
          } else {
            peg$currPos = s3;
            s3 = peg$FAILED;
          }
        } else {
          peg$currPos = s3;
          s3 = peg$FAILED;
        }
      }
      peg$savedPos = s0;
      s0 = peg$f13(s1, s2);
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseTermWithSign() {
    var s0, s1, s3;

    s0 = peg$currPos;
    s1 = input.charAt(peg$currPos);
    if (peg$r0.test(s1)) {
      peg$currPos++;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$e28); }
    }
    if (s1 !== peg$FAILED) {
      peg$parse_();
      s3 = peg$parseTerm();
      if (s3 !== peg$FAILED) {
        peg$savedPos = s0;
        s0 = peg$f14(s1, s3);
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseTerm() {
    var s0, s1, s3;

    s0 = peg$currPos;
    s1 = peg$parseNumber();
    if (s1 !== peg$FAILED) {
      peg$parse_();
      s3 = peg$parseVariableName();
      if (s3 !== peg$FAILED) {
        peg$savedPos = s0;
        s0 = peg$f15(s1, s3);
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    if (s0 === peg$FAILED) {
      s0 = peg$currPos;
      s1 = peg$parseVariableName();
      if (s1 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$f16(s1);
      }
      s0 = s1;
      if (s0 === peg$FAILED) {
        s0 = peg$currPos;
        s1 = peg$parseNumber();
        if (s1 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$f17(s1);
        }
        s0 = s1;
      }
    }

    return s0;
  }

  function peg$parseVariableName() {
    var s0, s1, s2, s3, s4, s5, s6;

    peg$silentFails++;
    s0 = peg$currPos;
    s1 = peg$currPos;
    peg$silentFails++;
    s2 = peg$parseBinaryHeader();
    peg$silentFails--;
    if (s2 === peg$FAILED) {
      s1 = undefined;
    } else {
      peg$currPos = s1;
      s1 = peg$FAILED;
    }
    if (s1 !== peg$FAILED) {
      s2 = peg$currPos;
      peg$silentFails++;
      s3 = peg$parseGeneralHeader();
      peg$silentFails--;
      if (s3 === peg$FAILED) {
        s2 = undefined;
      } else {
        peg$currPos = s2;
        s2 = peg$FAILED;
      }
      if (s2 !== peg$FAILED) {
        s3 = peg$currPos;
        peg$silentFails++;
        s4 = input.substr(peg$currPos, 3);
        if (s4.toLowerCase() === peg$c0) {
          peg$currPos += 3;
        } else {
          s4 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$e0); }
        }
        peg$silentFails--;
        if (s4 === peg$FAILED) {
          s3 = undefined;
        } else {
          peg$currPos = s3;
          s3 = peg$FAILED;
        }
        if (s3 !== peg$FAILED) {
          s4 = input.charAt(peg$currPos);
          if (peg$r1.test(s4)) {
            peg$currPos++;
          } else {
            s4 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$e30); }
          }
          if (s4 !== peg$FAILED) {
            s5 = [];
            s6 = input.charAt(peg$currPos);
            if (peg$r2.test(s6)) {
              peg$currPos++;
            } else {
              s6 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$e31); }
            }
            while (s6 !== peg$FAILED) {
              s5.push(s6);
              s6 = input.charAt(peg$currPos);
              if (peg$r2.test(s6)) {
                peg$currPos++;
              } else {
                s6 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$e31); }
              }
            }
            peg$savedPos = s0;
            s0 = peg$f18();
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    peg$silentFails--;
    if (s0 === peg$FAILED) {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$e29); }
    }

    return s0;
  }

  function peg$parseSignedNumber() {
    var s0, s1, s2;

    peg$silentFails++;
    s0 = peg$currPos;
    s1 = input.charAt(peg$currPos);
    if (peg$r0.test(s1)) {
      peg$currPos++;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$e28); }
    }
    if (s1 === peg$FAILED) {
      s1 = null;
    }
    s2 = peg$parseNumber();
    if (s2 !== peg$FAILED) {
      peg$savedPos = s0;
      s0 = peg$f19();
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    peg$silentFails--;
    if (s0 === peg$FAILED) {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$e32); }
    }

    return s0;
  }

  function peg$parseNumber() {
    var s0, s1, s2, s3, s4, s5, s6, s7;

    peg$silentFails++;
    s0 = peg$currPos;
    s1 = [];
    s2 = input.charAt(peg$currPos);
    if (peg$r3.test(s2)) {
      peg$currPos++;
    } else {
      s2 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$e34); }
    }
    if (s2 !== peg$FAILED) {
      while (s2 !== peg$FAILED) {
        s1.push(s2);
        s2 = input.charAt(peg$currPos);
        if (peg$r3.test(s2)) {
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$e34); }
        }
      }
    } else {
      s1 = peg$FAILED;
    }
    if (s1 !== peg$FAILED) {
      s2 = peg$currPos;
      if (input.charCodeAt(peg$currPos) === 46) {
        s3 = peg$c27;
        peg$currPos++;
      } else {
        s3 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$e35); }
      }
      if (s3 !== peg$FAILED) {
        s4 = [];
        s5 = input.charAt(peg$currPos);
        if (peg$r3.test(s5)) {
          peg$currPos++;
        } else {
          s5 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$e34); }
        }
        if (s5 !== peg$FAILED) {
          while (s5 !== peg$FAILED) {
            s4.push(s5);
            s5 = input.charAt(peg$currPos);
            if (peg$r3.test(s5)) {
              peg$currPos++;
            } else {
              s5 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$e34); }
            }
          }
        } else {
          s4 = peg$FAILED;
        }
        if (s4 !== peg$FAILED) {
          s3 = [s3, s4];
          s2 = s3;
        } else {
          peg$currPos = s2;
          s2 = peg$FAILED;
        }
      } else {
        peg$currPos = s2;
        s2 = peg$FAILED;
      }
      if (s2 === peg$FAILED) {
        s2 = null;
      }
      s3 = peg$currPos;
      s4 = input.charAt(peg$currPos);
      if (s4.toLowerCase() === peg$c28) {
        peg$currPos++;
      } else {
        s4 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$e36); }
      }
      if (s4 !== peg$FAILED) {
        s5 = input.charAt(peg$currPos);
        if (peg$r0.test(s5)) {
          peg$currPos++;
        } else {
          s5 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$e28); }
        }
        if (s5 === peg$FAILED) {
          s5 = null;
        }
        s6 = [];
        s7 = input.charAt(peg$currPos);
        if (peg$r3.test(s7)) {
          peg$currPos++;
        } else {
          s7 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$e34); }
        }
        if (s7 !== peg$FAILED) {
          while (s7 !== peg$FAILED) {
            s6.push(s7);
            s7 = input.charAt(peg$currPos);
            if (peg$r3.test(s7)) {
              peg$currPos++;
            } else {
              s7 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$e34); }
            }
          }
        } else {
          s6 = peg$FAILED;
        }
        if (s6 !== peg$FAILED) {
          s4 = [s4, s5, s6];
          s3 = s4;
        } else {
          peg$currPos = s3;
          s3 = peg$FAILED;
        }
      } else {
        peg$currPos = s3;
        s3 = peg$FAILED;
      }
      if (s3 === peg$FAILED) {
        s3 = null;
      }
      peg$savedPos = s0;
      s0 = peg$f20();
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    peg$silentFails--;
    if (s0 === peg$FAILED) {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$e33); }
    }

    return s0;
  }

  function peg$parse_() {
    var s0, s1, s2, s3, s4, s5, s6, s7, s8;

    peg$silentFails++;
    s0 = peg$currPos;
    s1 = [];
    s2 = input.charAt(peg$currPos);
    if (peg$r4.test(s2)) {
      peg$currPos++;
    } else {
      s2 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$e38); }
    }
    while (s2 !== peg$FAILED) {
      s1.push(s2);
      s2 = input.charAt(peg$currPos);
      if (peg$r4.test(s2)) {
        peg$currPos++;
      } else {
        s2 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$e38); }
      }
    }
    s2 = [];
    s3 = peg$currPos;
    if (input.charCodeAt(peg$currPos) === 92) {
      s4 = peg$c29;
      peg$currPos++;
    } else {
      s4 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$e39); }
    }
    if (s4 !== peg$FAILED) {
      s5 = [];
      s6 = input.charAt(peg$currPos);
      if (peg$r5.test(s6)) {
        peg$currPos++;
      } else {
        s6 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$e40); }
      }
      while (s6 !== peg$FAILED) {
        s5.push(s6);
        s6 = input.charAt(peg$currPos);
        if (peg$r5.test(s6)) {
          peg$currPos++;
        } else {
          s6 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$e40); }
        }
      }
      if (input.charCodeAt(peg$currPos) === 10) {
        s6 = peg$c30;
        peg$currPos++;
      } else {
        s6 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$e41); }
      }
      if (s6 !== peg$FAILED) {
        s7 = [];
        s8 = input.charAt(peg$currPos);
        if (peg$r4.test(s8)) {
          peg$currPos++;
        } else {
          s8 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$e38); }
        }
        while (s8 !== peg$FAILED) {
          s7.push(s8);
          s8 = input.charAt(peg$currPos);
          if (peg$r4.test(s8)) {
            peg$currPos++;
          } else {
            s8 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$e38); }
          }
        }
        s4 = [s4, s5, s6, s7];
        s3 = s4;
      } else {
        peg$currPos = s3;
        s3 = peg$FAILED;
      }
    } else {
      peg$currPos = s3;
      s3 = peg$FAILED;
    }
    while (s3 !== peg$FAILED) {
      s2.push(s3);
      s3 = peg$currPos;
      if (input.charCodeAt(peg$currPos) === 92) {
        s4 = peg$c29;
        peg$currPos++;
      } else {
        s4 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$e39); }
      }
      if (s4 !== peg$FAILED) {
        s5 = [];
        s6 = input.charAt(peg$currPos);
        if (peg$r5.test(s6)) {
          peg$currPos++;
        } else {
          s6 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$e40); }
        }
        while (s6 !== peg$FAILED) {
          s5.push(s6);
          s6 = input.charAt(peg$currPos);
          if (peg$r5.test(s6)) {
            peg$currPos++;
          } else {
            s6 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$e40); }
          }
        }
        if (input.charCodeAt(peg$currPos) === 10) {
          s6 = peg$c30;
          peg$currPos++;
        } else {
          s6 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$e41); }
        }
        if (s6 !== peg$FAILED) {
          s7 = [];
          s8 = input.charAt(peg$currPos);
          if (peg$r4.test(s8)) {
            peg$currPos++;
          } else {
            s8 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$e38); }
          }
          while (s8 !== peg$FAILED) {
            s7.push(s8);
            s8 = input.charAt(peg$currPos);
            if (peg$r4.test(s8)) {
              peg$currPos++;
            } else {
              s8 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$e38); }
            }
          }
          s4 = [s4, s5, s6, s7];
          s3 = s4;
        } else {
          peg$currPos = s3;
          s3 = peg$FAILED;
        }
      } else {
        peg$currPos = s3;
        s3 = peg$FAILED;
      }
    }
    s1 = [s1, s2];
    s0 = s1;
    peg$silentFails--;
    s1 = peg$FAILED;
    if (peg$silentFails === 0) { peg$fail(peg$e37); }

    return s0;
  }

  peg$result = peg$startRuleFunction();

  if (options.peg$library) {
    return /** @type {any} */ ({
      peg$result,
      peg$currPos,
      peg$FAILED,
      peg$maxFailExpected,
      peg$maxFailPos
    });
  }
  if (peg$result !== peg$FAILED && peg$currPos === input.length) {
    return peg$result;
  } else {
    if (peg$result !== peg$FAILED && peg$currPos < input.length) {
      peg$fail(peg$endExpectation());
    }

    throw peg$buildStructuredError(
      peg$maxFailExpected,
      peg$maxFailPos < input.length ? input.charAt(peg$maxFailPos) : null,
      peg$maxFailPos < input.length
        ? peg$computeLocation(peg$maxFailPos, peg$maxFailPos + 1)
        : peg$computeLocation(peg$maxFailPos, peg$maxFailPos)
    );
  }
}

function fromLPFormat(model, lpString) {
    const p = peg$parse(lpString);

    // Clear model
    model.clear();

    // Set up variables with bounds
    p.bounds.forEach(bound => {
        const options = { name: bound.variable };
        if (bound.lower !== undefined) {
            options.lb = bound.lower;
        }
        if (bound.upper !== undefined) {
            options.ub = bound.upper;
        }
        if (bound.range === 'free') {
            options.lb = '-infinity';
            options.ub = '+infinity';
        }
        model.addVar(options);
    });

    // Mark variables as binary or integer (general)
    p.binary.forEach(variable => {
        if (model.variables.has(variable)) {
            model.variables.get(variable).vtype = 'BINARY';
        } else {
            model.addVar({ name: variable, vtype: 'BINARY' });
        }
    });
    p.general.forEach(variable => {
        if (model.variables.has(variable)) {
            model.variables.get(variable).vtype = 'INTEGER';
        } else {
            model.addVar({ name: variable, vtype: 'INTEGER' });
        }
    });

    // Find undeclared variables in the objective and constraints
    const allVariables = new Set();
    p.objective.expression.forEach(term => allVariables.add(term.variable));
    p.constraints.forEach(constraint => constraint.expression.forEach(term => allVariables.add(term.variable)));
    allVariables.forEach(variable => { if (!model.variables.has(variable)) model.addVar({ name: variable }); });

    // Add objective
    const objectiveExpression = p.objective.expression.map(term => [term.coefficient, model.variables.get(term.variable)]);
    model.setObjective(objectiveExpression, p.objective.type === 'max' ? 'MAXIMIZE' : 'MINIMIZE');

    // Add constraints
    p.constraints.forEach(constraint => {
        const lhsExpression = constraint.expression.map(term => [term.coefficient, model.variables.get(term.variable)]);
        model.addConstr(lhsExpression, constraint.sense, constraint.value);
    });

    return model;
}

function toLPFormat(model) {
    let lpString = "";

    function expressionToString(expression) {
        return expression.map(term => {
            if (Array.isArray(term)) {
                if (term.length === 2) {
                    return `${term[0]} ${term[1].name}`;
                } else if (term.length === 3) {
                    return `[ ${term[0]*2} ${term[1].name} * ${term[2].name} ]/2`;
                }
            } else {
                return `${term}`;
            }
        }).join(" + ").replace(/\+ -/g, "- ");
    }

    // Objective Function
    lpString += `${model.objective.sense.toUpperCase() === "MAXIMIZE" ? "Maximize" : "Minimize"}\n`;
    const objExpression = model.objective.expression[0] === 0 ? model.objective.expression.slice(1) : model.objective.expression; // Remove constant term if zero
    lpString += `obj: ${expressionToString(objExpression)}\n`;

    // Constraints
    if (model.constraints.length > 0) {
        lpString += "Subject To\n";
        model.constraints.forEach((constr, index) => {
            lpString += ` c${index + 1}: ${expressionToString(constr.lhs.slice(1))} ${constr.comparison} ${constr.rhs}\n`;
        });
    }

    // Bounds
    let boundsString = "Bounds\n";
    model.variables.forEach((varObj, varName) => {
        if (varObj.vtype === "BINARY") {
            return;
        }
        if (varObj.lb === "-infinity" && varObj.ub === "+infinity") {
            boundsString += ` ${varName} free\n`;
        } else if (varObj.lb !== 0 || varObj.ub !== "+infinity") {
            boundsString += ` ${varObj.lb === "-infinity" ? "-inf" : varObj.lb} <= ${varName} <= ${varObj.ub === "+infinity" ? "+inf" : varObj.ub}\n`;
        }
    });
    lpString += boundsString;

    // Variable Types (General and Binary)
    let generalVars = [];
    let binaryVars = [];

    for (const [varName, varObj] of model.variables) {
        if (varObj.vtype === "INTEGER") {
            generalVars.push(varName);
        } else if (varObj.vtype === "BINARY") {
            binaryVars.push(varName);
        }
    }

    let typesString = "";
    if (generalVars.length > 0) {
        typesString += "General\n " + generalVars.join(" ") + "\n";
    }
    if (binaryVars.length > 0) {
        typesString += "Binary\n " + binaryVars.join(" ") + "\n";
    }
    lpString += typesString;

    // End
    lpString += "End\n";

    return lpString;
}

/**
 * A module for specifying LPs and ILPs using a convenient syntax, and solving them with various solvers.
 * @module lp-model
 */


/**
 * Represents a variable in a linear programming model.
 * @class
 */
class Var {
    /**
     * Creates an instance of a variable.
     * @param {Object} options - Configuration options for the variable.
     * @param {number | "-infinity"} [options.lb=0] - The lower bound of the variable. Default is 0. Use "-infinity" for no lower bound.
     * @param {number | "+infinity"} [options.ub="+infinity"] - The upper bound of the variable. Default is "+infinity". Use "+infinity" for no upper bound.
     * @param {"CONTINUOUS" | "BINARY" | "INTEGER"} [options.vtype="CONTINUOUS"] - The type of the variable. Default is "CONTINUOUS".
     * @param {string | null} [options.name=null] - The name of the variable. If null, a default name is assigned.
     * @throws Will throw an error if an invalid variable type or bound is provided.
     */
    constructor({ lb = 0, ub = "+infinity", vtype = "CONTINUOUS", name = null }) {
        if (!["CONTINUOUS", "BINARY", "INTEGER"].includes(vtype.toUpperCase())) {
            throw new Error(`Invalid variable type: ${vtype}. Must be one of "CONTINUOUS", "BINARY", or "INTEGER".`);
        }
        if (typeof lb !== "number" && lb !== "-infinity") {
            throw new Error(`Invalid lower bound: ${lb}. Must be a number or "-infinity".`);
        }
        if (typeof ub !== "number" && ub !== "+infinity") {
            throw new Error(`Invalid upper bound: ${ub}. Must be a number or "+infinity".`);
        }
        if (typeof lb === "number" && typeof ub === "number" && lb > ub) {
            throw new Error("Variable lower bound must be less than or equal to upper bound.");
        }
        this.lb = lb;
        this.ub = vtype === "BINARY" ? 1 : ub;
        this.vtype = vtype.toUpperCase();
        this.name = name;
    }
}

/**
 * Represents a constraint in a linear programming model.
 * @class
 */
class Constr {
    /**
     * Creates an instance of a constraint.
     * @param {Array} lhs - The left-hand side expression of the constraint.
     * @param {string} comparison - The comparison operator of the constraint. Can be "<=", "=", or ">=".
     * @param {number} rhs - The right-hand side number of the constraint.
     */
    constructor(lhs, comparison, rhs) {
        this.lhs = lhs; // Left-hand side expression
        this.comparison = comparison;
        this.rhs = rhs; // Right-hand side number
    }
}

/**
 * Represents a model in linear programming.
 * @class
 */
class Model {
    /**
     * Creates an instance of a model.
     */
    /**
     * Represents a mathematical optimization model.
     * @constructor
     */
    constructor() {
        this.variables = new Map();
        this.constraints = [];
        this.objective = { expression: [0], sense: "MAXIMIZE" };
        this.varCount = 0;

        /**
         * The solution of the optimization problem, provided directly by the solver.
         * @type {Object | null}
         */
        this.solution = null;

        /**
         * The status of the optimization problem, e.g., "Optimal", "Infeasible", "Unbounded", etc.
         * @type {String}
         */
        this.status = null;

        /**
         * The value of the objective function in the optimal solution.
         * @type {number | null}
         */
        this.ObjVal = null;
    }

    clear() {
        this.variables = new Map();
        this.constraints = [];
        this.objective = { expression: [0], sense: "MAXIMIZE" };
        this.varCount = 0;
        this.solution = null;
        this.status = null;
        this.ObjVal = null;
    }

    /**
     * Adds a variable to the model.
     * @param {Object} options - Options for creating the variable.
     * @param {number | "-infinity"} [options.lb=0] - The lower bound of the variable.
     * @param {number | "+infinity"} [options.ub="+infinity"] - The upper bound of the variable.
     * @param {"CONTINUOUS" | "BINARY" | "INTEGER"} [options.vtype="CONTINUOUS"] - The type of the variable.
     * @param {string} [options.name] - The name of the variable. If not provided, a unique name is generated.
     * @returns {Var} The created variable instance.
     * @throws Will throw an error if the variable name is already used.
     */
    addVar({ lb, ub, vtype, name } = {}) {
        if (name === null || name === undefined) {
            name = `Var${this.varCount++}`; // Assign an internal name if none provided
            while (this.variables.has(name)) {
                name = `Var${this.varCount++}`; // Ensure unique name
            }
        } else if (this.variables.has(name)) {
            throw new Error(`Variable name '${name}' has already been used.`);
        }
        const variable = new Var({ lb, ub, vtype, name });
        this.variables.set(name, variable);
        return variable;
    }

    /**
     * Adds multiple variables to the model based on an array of names.
     * Each variable is created with the same provided options.
     * @param {string[]} varNames - Array of names for the variables to be added.
     * @param {Object} options - Common options for creating the variables.
     * @param {number | "-infinity"} [options.lb=0] - The lower bound for all variables.
     * @param {number | "+infinity"} [options.ub="+infinity"] - The upper bound for all variables.
     * @param {"CONTINUOUS" | "BINARY" | "INTEGER"} [options.vtype="CONTINUOUS"] - The type for all variables.
     * @returns {Object} An object where keys are variable names and values are the created variable instances.
     * @throws Will throw an error if any variable name is already used or if any name in the array is not a string.
     */
    addVars(varNames, { lb, ub, vtype } = {}) {
        const createdVars = {};

        varNames.forEach(name => {
            if (typeof name !== 'string') {
                throw new Error(`Variable name must be a string, got '${typeof name}' for '${name}'.`);
            }
            if (this.variables.has(name)) {
                throw new Error(`Variable name '${name}' has already been used.`);
            }

            // Assign the provided options to the new variable
            const variable = new Var({ lb, ub, vtype, name });
            this.variables.set(name, variable);

            // Add the new variable to the returned object
            createdVars[name] = variable;
        });

        return createdVars;
    }

    /**
     * Sets the objective function of the model.
     * @param {Array} expression - The linear expression representing the objective function.
     * @param {"MAXIMIZE" | "MINIMIZE"} sense - The sense of optimization, either "MAXIMIZE" or "MINIMIZE".
     * @throws Will throw an error if an invalid sense is provided.
     */
    setObjective(expression, sense) {
        if (!["MAXIMIZE", "MINIMIZE"].includes(sense.toUpperCase())) {
            throw new Error(`Invalid sense: ${sense}. Must be one of "MAXIMIZE" or "MINIMIZE".`);
        }
        this.objective = { expression: this.parseExpression(expression), sense };
    }

    /**
     * Adds a constraint to the model.
     * @param {Array} lhs - The left-hand side expression of the constraint.
     * @param {string} comparison - The comparison operator, either "<=", "=", or ">=".
     * @param {number | Array} rhs - The right-hand side, which can be a number or a linear expression.
     * @returns {Constr} The created constraint instance.
     */
    addConstr(lhs, comparison, rhs) {
        lhs = this.parseExpression(lhs);
        rhs = typeof rhs === 'number' ? [rhs] : this.parseExpression(rhs);

        if (comparison === "==") comparison = "="; // Convert to standard comparison operator
        if (!["<=", "=", ">="].includes(comparison)) {
            throw new Error(`Invalid comparison operator: ${comparison}. Must be one of "<=", "=", or ">=".`);
        }

        // Combine LHS and negated RHS
        const combinedLhs = lhs.concat(rhs.map(term => {
            if (Array.isArray(term)) {
                if (term.length === 2) {
                    return [-term[0], term[1]]; // Negate the coefficient
                } else if (term.length === 3) {
                    return [-term[0], term[1], term[2]]; // Negate the coefficient
                }
            }
            return -term; // Negate the constant term
        }));

        const finalLhs = this.parseExpression(combinedLhs); // Parse again to combine like terms
        const finalRhs = -finalLhs[0]; // RHS is the negated first term in the combined expression
        finalLhs[0] = 0; // Remove the constant term from LHS
        const constraint = new Constr(finalLhs, comparison, finalRhs);
        this.constraints.push(constraint);
        return constraint;
    }

    /**
     * Parses a linear expression from a more flexible input format.
     * @param {Array} expression - The expression to parse, which can include numbers, variables, or arrays representing terms.
     * @returns {Array} The parsed linear expression in a canonical format.
     * @throws Will throw an error if an invalid item is included in the expression.
     */
    parseExpression(expression) {
        let combined = { 'constant': 0 };

        for (let item of expression) {
            if (Array.isArray(item)) {
                if (item.length === 2) {
                    // Item is a term like [coefficient, variable]
                    const [coeff, varObj] = item;
                    if (!(varObj instanceof Var) || typeof coeff !== 'number') {
                        throw new Error(`Invalid term: ${item}. Must be [coefficient, variable].`);
                    }
                    if (combined[varObj.name]) {
                        combined[varObj.name][0] += coeff;
                    } else {
                        combined[varObj.name] = [coeff, varObj];
                    }
                } else if (item.length === 3) {
                    // Quadratic term like [coefficient, variable1, variable2]
                    const [coeff, varObj1, varObj2] = item;
                    if (!(varObj1 instanceof Var) || !(varObj2 instanceof Var) || typeof coeff !== 'number') {
                        throw new Error(`Invalid quadratic term: ${item}. Must be [coefficient, variable1, variable2].`);
                    }
                    let v1 = varObj1.name;
                    let v2 = varObj2.name;
                    if (v1 > v2) { [v1, v2] = [v2, v1]; } // Ensure consistent order
                    const termName = `${v1}_***_${v2}`;
                    if (combined[termName]) {
                        combined[termName][0] += coeff;
                    } else {
                        combined[termName] = [coeff, this.variables.get(v1), this.variables.get(v2)];
                    }
                } else {
                    throw new Error(`Invalid expression item: ${item}. Must be [coefficient, variable] or [coefficient, variable1, variable2].`);
                }
            } else if (item instanceof Var) {
                // Item is a variable, treat it as [1, variable]
                const varName = item.name;
                if (combined[varName]) {
                    combined[varName][0] += 1;
                } else {
                    combined[varName] = [1, item];
                }
            } else if (typeof item === 'number') {
                // Item is a constant, add it to the constant term
                combined['constant'] += item;
            } else {
                throw new Error("Invalid expression item.");
            }
        }

        // Convert combined terms back to array format, ensuring constant term is first
        let parsedExpression = [combined['constant']];
        delete combined['constant'];

        for (let termName in combined) {
            if (combined[termName][0] !== 0) { // Exclude zero-coefficient terms
                parsedExpression.push(combined[termName]);
            }
        }

        return parsedExpression;
    }

    /**
     * Converts the model to CPLEX LP file format, provided as a string.
     * @returns {string} The model represented in LP format.
     * @see {@link https://web.mit.edu/lpsolve/doc/CPLEX-format.htm}
     */
    toLPFormat() {
        return toLPFormat(this);
    }

    /**
     * Clears the model, then adds variables and constraints taken from a string formatted in the CPLEX LP file format.
     * @param {string} lpString - The LP file as a string.
     * @see {@link https://web.mit.edu/lpsolve/doc/CPLEX-format.htm}
     */
    readLPFormat(lpString) {
        return fromLPFormat(this, lpString);
    }

    /**
     * Checks if the model is quadratic, i.e., if it contains any quadratic terms in the objective function or constraints.
     * @returns {boolean} True if the model is quadratic, false otherwise.
     */
    isQuadratic() {
        function isQuadraticExpression(expression) {
            return expression.some(term => Array.isArray(term) && term.length === 3);
        }

        return isQuadraticExpression(this.objective.expression)
            || this.constraints.some(constr => isQuadraticExpression(constr.lhs));
    }

    /**
     * Reads and applies the solution from the HiGHS.js solver to the model's variables and constraints.
     * @param {Object} solution - The solution object returned by the HiGHS solver.
     */
    readHighsSolution(solution) {
        readHighsSolution(this, solution);
    }

    /**
     * Converts the model to the JSON format for use with the glpk.js solver.
     * @returns {Object} The model represented in the JSON format for glpk.js.
     * @see {@link https://github.com/jvail/glpk.js}
     */
    toGLPKFormat() {
        if (this.isQuadratic()) {
            throw new Error("GLPK.js does not support quadratic models.");
        }
        return toGLPKFormat(this);
    }

    /**
     * Reads and applies the solution from the glpk.js solver to the model's variables and constraints.
     * @param {Object} solution - The solution object returned by the glpk.js solver.
     */
    readGLPKSolution(solution) {
        readGLPKSolution(this, solution);
    }

    /**
     * Converts the model to the JSON format for use with the jsLPSolver solver.
     * @returns {Object} The model represented in the JSON format for jsLPSolver.
     * @see {@link https://www.npmjs.com/package/jsLPSolver}
     */
    toJSLPSolverFormat(options) {
        if (this.isQuadratic()) {
            throw new Error("jsLPSolver does not support quadratic models.");
        }
        return toJSLPSolverFormat(this, options);
    }

    /**
     * Reads and applies the solution from the jsLPSolver solver to the model's variables and constraints.
     * @param {Object} solution - The solution object returned by the jsLPSolver solver.
     * @see {@link https://www.npmjs.com/package/jsLPSolver}
     */
    readJSLPSolverSolution(solution) {
        readJSLPSolverSolution(this, solution);
    }

    /**
     * Solves the model using the provided solver. HiGHS.js or glpk.js can be used. 
     * The solution can be accessed from the variables' `value` properties and the constraints' `primal` and `dual` properties.
     * @param {Object} solver - The solver instance to use for solving the model, either HiGHS.js or glpk.js.
     * @param {Object} [options={}] - Options to pass to the solver's solve method (refer to their respective documentation: https://ergo-code.github.io/HiGHS/dev/options/definitions/, https://www.npmjs.com/package/glpk.js).
     */
    async solve(solver, options = {}) {
        // clear previous solution
        this.solution = null;
        this.variables.forEach(variable => variable.value = null);
        this.constraints.forEach(constraint => {
            constraint.primal = null;
            constraint.dual = null;
        });
        this.ObjVal = null;

        // run solver
        if (Object.hasOwn(solver, 'branchAndCut') && Object.hasOwn(solver, 'lastSolvedModel')) { // jsLPSolver
            this.solution = solver.Solve(this.toJSLPSolverFormat(options));
            this.readJSLPSolverSolution(this.solution);
        } else if (Object.hasOwn(solver, 'GLP_OPT')) { // glpk.js
            this.solution = await solver.solve(this.toGLPKFormat(), options);
            this.readGLPKSolution(this.solution);
        } else if (Object.hasOwn(solver, '_Highs_run')) { // highs-js
            this.solution = solver.solve(this.toLPFormat(), options);
            this.readHighsSolution(this.solution);
        }
    }
}

export { Constr, Model, Var };
