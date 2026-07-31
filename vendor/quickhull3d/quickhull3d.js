var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/gl-vec3/normalize.js
var require_normalize = __commonJS({
  "node_modules/gl-vec3/normalize.js"(exports, module) {
    module.exports = normalize2;
    function normalize2(out, a) {
      var x = a[0], y = a[1], z = a[2];
      var len = x * x + y * y + z * z;
      if (len > 0) {
        len = 1 / Math.sqrt(len);
        out[0] = a[0] * len;
        out[1] = a[1] * len;
        out[2] = a[2] * len;
      }
      return out;
    }
  }
});

// node_modules/gl-vec3/subtract.js
var require_subtract = __commonJS({
  "node_modules/gl-vec3/subtract.js"(exports, module) {
    module.exports = subtract2;
    function subtract2(out, a, b) {
      out[0] = a[0] - b[0];
      out[1] = a[1] - b[1];
      out[2] = a[2] - b[2];
      return out;
    }
  }
});

// node_modules/gl-vec3/cross.js
var require_cross = __commonJS({
  "node_modules/gl-vec3/cross.js"(exports, module) {
    module.exports = cross2;
    function cross2(out, a, b) {
      var ax = a[0], ay = a[1], az = a[2], bx = b[0], by = b[1], bz = b[2];
      out[0] = ay * bz - az * by;
      out[1] = az * bx - ax * bz;
      out[2] = ax * by - ay * bx;
      return out;
    }
  }
});

// node_modules/get-plane-normal/index.js
var require_get_plane_normal = __commonJS({
  "node_modules/get-plane-normal/index.js"(exports, module) {
    var normalize2 = require_normalize();
    var sub = require_subtract();
    var cross2 = require_cross();
    var tmp = [0, 0, 0];
    module.exports = planeNormal;
    function planeNormal(out, point1, point2, point3) {
      sub(out, point1, point2);
      sub(tmp, point2, point3);
      cross2(out, out, tmp);
      return normalize2(out, out);
    }
  }
});

// node_modules/gl-vec3/squaredLength.js
var require_squaredLength = __commonJS({
  "node_modules/gl-vec3/squaredLength.js"(exports, module) {
    module.exports = squaredLength;
    function squaredLength(a) {
      var x = a[0], y = a[1], z = a[2];
      return x * x + y * y + z * z;
    }
  }
});

// node_modules/point-line-distance/squared.js
var require_squared = __commonJS({
  "node_modules/point-line-distance/squared.js"(exports, module) {
    var subtract2 = require_subtract();
    var cross2 = require_cross();
    var squaredLength = require_squaredLength();
    var ab = [];
    var ap = [];
    var cr = [];
    module.exports = function(p, a, b) {
      subtract2(ab, b, a);
      subtract2(ap, p, a);
      var area = squaredLength(cross2(cr, ap, ab));
      var s = squaredLength(ab);
      if (s === 0) {
        throw Error("a and b are the same point");
      }
      return area / s;
    };
  }
});

// node_modules/point-line-distance/index.js
var require_point_line_distance = __commonJS({
  "node_modules/point-line-distance/index.js"(exports, module) {
    "use strict";
    var distanceSquared = require_squared();
    module.exports = function(point, a, b) {
      return Math.sqrt(distanceSquared(point, a, b));
    };
  }
});

// node_modules/two-product/two-product.js
var require_two_product = __commonJS({
  "node_modules/two-product/two-product.js"(exports, module) {
    "use strict";
    module.exports = twoProduct;
    var SPLITTER = +(Math.pow(2, 27) + 1);
    function twoProduct(a, b, result) {
      var x = a * b;
      var c = SPLITTER * a;
      var abig = c - a;
      var ahi = c - abig;
      var alo = a - ahi;
      var d = SPLITTER * b;
      var bbig = d - b;
      var bhi = d - bbig;
      var blo = b - bhi;
      var err1 = x - ahi * bhi;
      var err2 = err1 - alo * bhi;
      var err3 = err2 - ahi * blo;
      var y = alo * blo - err3;
      if (result) {
        result[0] = y;
        result[1] = x;
        return result;
      }
      return [y, x];
    }
  }
});

// node_modules/robust-sum/robust-sum.js
var require_robust_sum = __commonJS({
  "node_modules/robust-sum/robust-sum.js"(exports, module) {
    "use strict";
    module.exports = linearExpansionSum;
    function scalarScalar(a, b) {
      var x = a + b;
      var bv = x - a;
      var av = x - bv;
      var br = b - bv;
      var ar = a - av;
      var y = ar + br;
      if (y) {
        return [y, x];
      }
      return [x];
    }
    function linearExpansionSum(e, f) {
      var ne = e.length | 0;
      var nf = f.length | 0;
      if (ne === 1 && nf === 1) {
        return scalarScalar(e[0], f[0]);
      }
      var n = ne + nf;
      var g = new Array(n);
      var count = 0;
      var eptr = 0;
      var fptr = 0;
      var abs = Math.abs;
      var ei = e[eptr];
      var ea = abs(ei);
      var fi = f[fptr];
      var fa = abs(fi);
      var a, b;
      if (ea < fa) {
        b = ei;
        eptr += 1;
        if (eptr < ne) {
          ei = e[eptr];
          ea = abs(ei);
        }
      } else {
        b = fi;
        fptr += 1;
        if (fptr < nf) {
          fi = f[fptr];
          fa = abs(fi);
        }
      }
      if (eptr < ne && ea < fa || fptr >= nf) {
        a = ei;
        eptr += 1;
        if (eptr < ne) {
          ei = e[eptr];
          ea = abs(ei);
        }
      } else {
        a = fi;
        fptr += 1;
        if (fptr < nf) {
          fi = f[fptr];
          fa = abs(fi);
        }
      }
      var x = a + b;
      var bv = x - a;
      var y = b - bv;
      var q0 = y;
      var q1 = x;
      var _x, _bv, _av, _br, _ar;
      while (eptr < ne && fptr < nf) {
        if (ea < fa) {
          a = ei;
          eptr += 1;
          if (eptr < ne) {
            ei = e[eptr];
            ea = abs(ei);
          }
        } else {
          a = fi;
          fptr += 1;
          if (fptr < nf) {
            fi = f[fptr];
            fa = abs(fi);
          }
        }
        b = q0;
        x = a + b;
        bv = x - a;
        y = b - bv;
        if (y) {
          g[count++] = y;
        }
        _x = q1 + x;
        _bv = _x - q1;
        _av = _x - _bv;
        _br = x - _bv;
        _ar = q1 - _av;
        q0 = _ar + _br;
        q1 = _x;
      }
      while (eptr < ne) {
        a = ei;
        b = q0;
        x = a + b;
        bv = x - a;
        y = b - bv;
        if (y) {
          g[count++] = y;
        }
        _x = q1 + x;
        _bv = _x - q1;
        _av = _x - _bv;
        _br = x - _bv;
        _ar = q1 - _av;
        q0 = _ar + _br;
        q1 = _x;
        eptr += 1;
        if (eptr < ne) {
          ei = e[eptr];
        }
      }
      while (fptr < nf) {
        a = fi;
        b = q0;
        x = a + b;
        bv = x - a;
        y = b - bv;
        if (y) {
          g[count++] = y;
        }
        _x = q1 + x;
        _bv = _x - q1;
        _av = _x - _bv;
        _br = x - _bv;
        _ar = q1 - _av;
        q0 = _ar + _br;
        q1 = _x;
        fptr += 1;
        if (fptr < nf) {
          fi = f[fptr];
        }
      }
      if (q0) {
        g[count++] = q0;
      }
      if (q1) {
        g[count++] = q1;
      }
      if (!count) {
        g[count++] = 0;
      }
      g.length = count;
      return g;
    }
  }
});

// node_modules/two-sum/two-sum.js
var require_two_sum = __commonJS({
  "node_modules/two-sum/two-sum.js"(exports, module) {
    "use strict";
    module.exports = fastTwoSum;
    function fastTwoSum(a, b, result) {
      var x = a + b;
      var bv = x - a;
      var av = x - bv;
      var br = b - bv;
      var ar = a - av;
      if (result) {
        result[0] = ar + br;
        result[1] = x;
        return result;
      }
      return [ar + br, x];
    }
  }
});

// node_modules/robust-scale/robust-scale.js
var require_robust_scale = __commonJS({
  "node_modules/robust-scale/robust-scale.js"(exports, module) {
    "use strict";
    var twoProduct = require_two_product();
    var twoSum = require_two_sum();
    module.exports = scaleLinearExpansion;
    function scaleLinearExpansion(e, scale3) {
      var n = e.length;
      if (n === 1) {
        var ts = twoProduct(e[0], scale3);
        if (ts[0]) {
          return ts;
        }
        return [ts[1]];
      }
      var g = new Array(2 * n);
      var q = [0.1, 0.1];
      var t = [0.1, 0.1];
      var count = 0;
      twoProduct(e[0], scale3, q);
      if (q[0]) {
        g[count++] = q[0];
      }
      for (var i = 1; i < n; ++i) {
        twoProduct(e[i], scale3, t);
        var pq = q[1];
        twoSum(pq, t[0], q);
        if (q[0]) {
          g[count++] = q[0];
        }
        var a = t[1];
        var b = q[1];
        var x = a + b;
        var bv = x - a;
        var y = b - bv;
        q[1] = x;
        if (y) {
          g[count++] = y;
        }
      }
      if (q[1]) {
        g[count++] = q[1];
      }
      if (count === 0) {
        g[count++] = 0;
      }
      g.length = count;
      return g;
    }
  }
});

// node_modules/robust-subtract/robust-diff.js
var require_robust_diff = __commonJS({
  "node_modules/robust-subtract/robust-diff.js"(exports, module) {
    "use strict";
    module.exports = robustSubtract;
    function scalarScalar(a, b) {
      var x = a + b;
      var bv = x - a;
      var av = x - bv;
      var br = b - bv;
      var ar = a - av;
      var y = ar + br;
      if (y) {
        return [y, x];
      }
      return [x];
    }
    function robustSubtract(e, f) {
      var ne = e.length | 0;
      var nf = f.length | 0;
      if (ne === 1 && nf === 1) {
        return scalarScalar(e[0], -f[0]);
      }
      var n = ne + nf;
      var g = new Array(n);
      var count = 0;
      var eptr = 0;
      var fptr = 0;
      var abs = Math.abs;
      var ei = e[eptr];
      var ea = abs(ei);
      var fi = -f[fptr];
      var fa = abs(fi);
      var a, b;
      if (ea < fa) {
        b = ei;
        eptr += 1;
        if (eptr < ne) {
          ei = e[eptr];
          ea = abs(ei);
        }
      } else {
        b = fi;
        fptr += 1;
        if (fptr < nf) {
          fi = -f[fptr];
          fa = abs(fi);
        }
      }
      if (eptr < ne && ea < fa || fptr >= nf) {
        a = ei;
        eptr += 1;
        if (eptr < ne) {
          ei = e[eptr];
          ea = abs(ei);
        }
      } else {
        a = fi;
        fptr += 1;
        if (fptr < nf) {
          fi = -f[fptr];
          fa = abs(fi);
        }
      }
      var x = a + b;
      var bv = x - a;
      var y = b - bv;
      var q0 = y;
      var q1 = x;
      var _x, _bv, _av, _br, _ar;
      while (eptr < ne && fptr < nf) {
        if (ea < fa) {
          a = ei;
          eptr += 1;
          if (eptr < ne) {
            ei = e[eptr];
            ea = abs(ei);
          }
        } else {
          a = fi;
          fptr += 1;
          if (fptr < nf) {
            fi = -f[fptr];
            fa = abs(fi);
          }
        }
        b = q0;
        x = a + b;
        bv = x - a;
        y = b - bv;
        if (y) {
          g[count++] = y;
        }
        _x = q1 + x;
        _bv = _x - q1;
        _av = _x - _bv;
        _br = x - _bv;
        _ar = q1 - _av;
        q0 = _ar + _br;
        q1 = _x;
      }
      while (eptr < ne) {
        a = ei;
        b = q0;
        x = a + b;
        bv = x - a;
        y = b - bv;
        if (y) {
          g[count++] = y;
        }
        _x = q1 + x;
        _bv = _x - q1;
        _av = _x - _bv;
        _br = x - _bv;
        _ar = q1 - _av;
        q0 = _ar + _br;
        q1 = _x;
        eptr += 1;
        if (eptr < ne) {
          ei = e[eptr];
        }
      }
      while (fptr < nf) {
        a = fi;
        b = q0;
        x = a + b;
        bv = x - a;
        y = b - bv;
        if (y) {
          g[count++] = y;
        }
        _x = q1 + x;
        _bv = _x - q1;
        _av = _x - _bv;
        _br = x - _bv;
        _ar = q1 - _av;
        q0 = _ar + _br;
        q1 = _x;
        fptr += 1;
        if (fptr < nf) {
          fi = -f[fptr];
        }
      }
      if (q0) {
        g[count++] = q0;
      }
      if (q1) {
        g[count++] = q1;
      }
      if (!count) {
        g[count++] = 0;
      }
      g.length = count;
      return g;
    }
  }
});

// node_modules/robust-orientation/orientation.js
var require_orientation = __commonJS({
  "node_modules/robust-orientation/orientation.js"(exports, module) {
    "use strict";
    var twoProduct = require_two_product();
    var robustSum = require_robust_sum();
    var robustScale = require_robust_scale();
    var robustSubtract = require_robust_diff();
    var NUM_EXPAND = 5;
    var EPSILON = 11102230246251565e-32;
    var ERRBOUND3 = (3 + 16 * EPSILON) * EPSILON;
    var ERRBOUND4 = (7 + 56 * EPSILON) * EPSILON;
    function orientation_3(sum, prod, scale3, sub) {
      return function orientation3Exact2(m0, m1, m2) {
        var p = sum(sum(prod(m1[1], m2[0]), prod(-m2[1], m1[0])), sum(prod(m0[1], m1[0]), prod(-m1[1], m0[0])));
        var n = sum(prod(m0[1], m2[0]), prod(-m2[1], m0[0]));
        var d = sub(p, n);
        return d[d.length - 1];
      };
    }
    function orientation_4(sum, prod, scale3, sub) {
      return function orientation4Exact2(m0, m1, m2, m3) {
        var p = sum(sum(scale3(sum(prod(m2[1], m3[0]), prod(-m3[1], m2[0])), m1[2]), sum(scale3(sum(prod(m1[1], m3[0]), prod(-m3[1], m1[0])), -m2[2]), scale3(sum(prod(m1[1], m2[0]), prod(-m2[1], m1[0])), m3[2]))), sum(scale3(sum(prod(m1[1], m3[0]), prod(-m3[1], m1[0])), m0[2]), sum(scale3(sum(prod(m0[1], m3[0]), prod(-m3[1], m0[0])), -m1[2]), scale3(sum(prod(m0[1], m1[0]), prod(-m1[1], m0[0])), m3[2]))));
        var n = sum(sum(scale3(sum(prod(m2[1], m3[0]), prod(-m3[1], m2[0])), m0[2]), sum(scale3(sum(prod(m0[1], m3[0]), prod(-m3[1], m0[0])), -m2[2]), scale3(sum(prod(m0[1], m2[0]), prod(-m2[1], m0[0])), m3[2]))), sum(scale3(sum(prod(m1[1], m2[0]), prod(-m2[1], m1[0])), m0[2]), sum(scale3(sum(prod(m0[1], m2[0]), prod(-m2[1], m0[0])), -m1[2]), scale3(sum(prod(m0[1], m1[0]), prod(-m1[1], m0[0])), m2[2]))));
        var d = sub(p, n);
        return d[d.length - 1];
      };
    }
    function orientation_5(sum, prod, scale3, sub) {
      return function orientation5Exact(m0, m1, m2, m3, m4) {
        var p = sum(sum(sum(scale3(sum(scale3(sum(prod(m3[1], m4[0]), prod(-m4[1], m3[0])), m2[2]), sum(scale3(sum(prod(m2[1], m4[0]), prod(-m4[1], m2[0])), -m3[2]), scale3(sum(prod(m2[1], m3[0]), prod(-m3[1], m2[0])), m4[2]))), m1[3]), sum(scale3(sum(scale3(sum(prod(m3[1], m4[0]), prod(-m4[1], m3[0])), m1[2]), sum(scale3(sum(prod(m1[1], m4[0]), prod(-m4[1], m1[0])), -m3[2]), scale3(sum(prod(m1[1], m3[0]), prod(-m3[1], m1[0])), m4[2]))), -m2[3]), scale3(sum(scale3(sum(prod(m2[1], m4[0]), prod(-m4[1], m2[0])), m1[2]), sum(scale3(sum(prod(m1[1], m4[0]), prod(-m4[1], m1[0])), -m2[2]), scale3(sum(prod(m1[1], m2[0]), prod(-m2[1], m1[0])), m4[2]))), m3[3]))), sum(scale3(sum(scale3(sum(prod(m2[1], m3[0]), prod(-m3[1], m2[0])), m1[2]), sum(scale3(sum(prod(m1[1], m3[0]), prod(-m3[1], m1[0])), -m2[2]), scale3(sum(prod(m1[1], m2[0]), prod(-m2[1], m1[0])), m3[2]))), -m4[3]), sum(scale3(sum(scale3(sum(prod(m3[1], m4[0]), prod(-m4[1], m3[0])), m1[2]), sum(scale3(sum(prod(m1[1], m4[0]), prod(-m4[1], m1[0])), -m3[2]), scale3(sum(prod(m1[1], m3[0]), prod(-m3[1], m1[0])), m4[2]))), m0[3]), scale3(sum(scale3(sum(prod(m3[1], m4[0]), prod(-m4[1], m3[0])), m0[2]), sum(scale3(sum(prod(m0[1], m4[0]), prod(-m4[1], m0[0])), -m3[2]), scale3(sum(prod(m0[1], m3[0]), prod(-m3[1], m0[0])), m4[2]))), -m1[3])))), sum(sum(scale3(sum(scale3(sum(prod(m1[1], m4[0]), prod(-m4[1], m1[0])), m0[2]), sum(scale3(sum(prod(m0[1], m4[0]), prod(-m4[1], m0[0])), -m1[2]), scale3(sum(prod(m0[1], m1[0]), prod(-m1[1], m0[0])), m4[2]))), m3[3]), sum(scale3(sum(scale3(sum(prod(m1[1], m3[0]), prod(-m3[1], m1[0])), m0[2]), sum(scale3(sum(prod(m0[1], m3[0]), prod(-m3[1], m0[0])), -m1[2]), scale3(sum(prod(m0[1], m1[0]), prod(-m1[1], m0[0])), m3[2]))), -m4[3]), scale3(sum(scale3(sum(prod(m2[1], m3[0]), prod(-m3[1], m2[0])), m1[2]), sum(scale3(sum(prod(m1[1], m3[0]), prod(-m3[1], m1[0])), -m2[2]), scale3(sum(prod(m1[1], m2[0]), prod(-m2[1], m1[0])), m3[2]))), m0[3]))), sum(scale3(sum(scale3(sum(prod(m2[1], m3[0]), prod(-m3[1], m2[0])), m0[2]), sum(scale3(sum(prod(m0[1], m3[0]), prod(-m3[1], m0[0])), -m2[2]), scale3(sum(prod(m0[1], m2[0]), prod(-m2[1], m0[0])), m3[2]))), -m1[3]), sum(scale3(sum(scale3(sum(prod(m1[1], m3[0]), prod(-m3[1], m1[0])), m0[2]), sum(scale3(sum(prod(m0[1], m3[0]), prod(-m3[1], m0[0])), -m1[2]), scale3(sum(prod(m0[1], m1[0]), prod(-m1[1], m0[0])), m3[2]))), m2[3]), scale3(sum(scale3(sum(prod(m1[1], m2[0]), prod(-m2[1], m1[0])), m0[2]), sum(scale3(sum(prod(m0[1], m2[0]), prod(-m2[1], m0[0])), -m1[2]), scale3(sum(prod(m0[1], m1[0]), prod(-m1[1], m0[0])), m2[2]))), -m3[3])))));
        var n = sum(sum(sum(scale3(sum(scale3(sum(prod(m3[1], m4[0]), prod(-m4[1], m3[0])), m2[2]), sum(scale3(sum(prod(m2[1], m4[0]), prod(-m4[1], m2[0])), -m3[2]), scale3(sum(prod(m2[1], m3[0]), prod(-m3[1], m2[0])), m4[2]))), m0[3]), scale3(sum(scale3(sum(prod(m3[1], m4[0]), prod(-m4[1], m3[0])), m0[2]), sum(scale3(sum(prod(m0[1], m4[0]), prod(-m4[1], m0[0])), -m3[2]), scale3(sum(prod(m0[1], m3[0]), prod(-m3[1], m0[0])), m4[2]))), -m2[3])), sum(scale3(sum(scale3(sum(prod(m2[1], m4[0]), prod(-m4[1], m2[0])), m0[2]), sum(scale3(sum(prod(m0[1], m4[0]), prod(-m4[1], m0[0])), -m2[2]), scale3(sum(prod(m0[1], m2[0]), prod(-m2[1], m0[0])), m4[2]))), m3[3]), scale3(sum(scale3(sum(prod(m2[1], m3[0]), prod(-m3[1], m2[0])), m0[2]), sum(scale3(sum(prod(m0[1], m3[0]), prod(-m3[1], m0[0])), -m2[2]), scale3(sum(prod(m0[1], m2[0]), prod(-m2[1], m0[0])), m3[2]))), -m4[3]))), sum(sum(scale3(sum(scale3(sum(prod(m2[1], m4[0]), prod(-m4[1], m2[0])), m1[2]), sum(scale3(sum(prod(m1[1], m4[0]), prod(-m4[1], m1[0])), -m2[2]), scale3(sum(prod(m1[1], m2[0]), prod(-m2[1], m1[0])), m4[2]))), m0[3]), scale3(sum(scale3(sum(prod(m2[1], m4[0]), prod(-m4[1], m2[0])), m0[2]), sum(scale3(sum(prod(m0[1], m4[0]), prod(-m4[1], m0[0])), -m2[2]), scale3(sum(prod(m0[1], m2[0]), prod(-m2[1], m0[0])), m4[2]))), -m1[3])), sum(scale3(sum(scale3(sum(prod(m1[1], m4[0]), prod(-m4[1], m1[0])), m0[2]), sum(scale3(sum(prod(m0[1], m4[0]), prod(-m4[1], m0[0])), -m1[2]), scale3(sum(prod(m0[1], m1[0]), prod(-m1[1], m0[0])), m4[2]))), m2[3]), scale3(sum(scale3(sum(prod(m1[1], m2[0]), prod(-m2[1], m1[0])), m0[2]), sum(scale3(sum(prod(m0[1], m2[0]), prod(-m2[1], m0[0])), -m1[2]), scale3(sum(prod(m0[1], m1[0]), prod(-m1[1], m0[0])), m2[2]))), -m4[3]))));
        var d = sub(p, n);
        return d[d.length - 1];
      };
    }
    function orientation(n) {
      var fn = n === 3 ? orientation_3 : n === 4 ? orientation_4 : orientation_5;
      return fn(robustSum, twoProduct, robustScale, robustSubtract);
    }
    var orientation3Exact = orientation(3);
    var orientation4Exact = orientation(4);
    var CACHED = [
      function orientation0() {
        return 0;
      },
      function orientation1() {
        return 0;
      },
      function orientation2(a, b) {
        return b[0] - a[0];
      },
      function orientation3(a, b, c) {
        var l = (a[1] - c[1]) * (b[0] - c[0]);
        var r = (a[0] - c[0]) * (b[1] - c[1]);
        var det = l - r;
        var s;
        if (l > 0) {
          if (r <= 0) {
            return det;
          } else {
            s = l + r;
          }
        } else if (l < 0) {
          if (r >= 0) {
            return det;
          } else {
            s = -(l + r);
          }
        } else {
          return det;
        }
        var tol = ERRBOUND3 * s;
        if (det >= tol || det <= -tol) {
          return det;
        }
        return orientation3Exact(a, b, c);
      },
      function orientation4(a, b, c, d) {
        var adx = a[0] - d[0];
        var bdx = b[0] - d[0];
        var cdx = c[0] - d[0];
        var ady = a[1] - d[1];
        var bdy = b[1] - d[1];
        var cdy = c[1] - d[1];
        var adz = a[2] - d[2];
        var bdz = b[2] - d[2];
        var cdz = c[2] - d[2];
        var bdxcdy = bdx * cdy;
        var cdxbdy = cdx * bdy;
        var cdxady = cdx * ady;
        var adxcdy = adx * cdy;
        var adxbdy = adx * bdy;
        var bdxady = bdx * ady;
        var det = adz * (bdxcdy - cdxbdy) + bdz * (cdxady - adxcdy) + cdz * (adxbdy - bdxady);
        var permanent = (Math.abs(bdxcdy) + Math.abs(cdxbdy)) * Math.abs(adz) + (Math.abs(cdxady) + Math.abs(adxcdy)) * Math.abs(bdz) + (Math.abs(adxbdy) + Math.abs(bdxady)) * Math.abs(cdz);
        var tol = ERRBOUND4 * permanent;
        if (det > tol || -det > tol) {
          return det;
        }
        return orientation4Exact(a, b, c, d);
      }
    ];
    function slowOrient(args) {
      var proc2 = CACHED[args.length];
      if (!proc2) {
        proc2 = CACHED[args.length] = orientation(args.length);
      }
      return proc2.apply(void 0, args);
    }
    function proc(slow, o0, o1, o2, o3, o4, o5) {
      return function getOrientation(a0, a1, a2, a3, a4) {
        switch (arguments.length) {
          case 0:
          case 1:
            return 0;
          case 2:
            return o2(a0, a1);
          case 3:
            return o3(a0, a1, a2);
          case 4:
            return o4(a0, a1, a2, a3);
          case 5:
            return o5(a0, a1, a2, a3, a4);
        }
        var s = new Array(arguments.length);
        for (var i = 0; i < arguments.length; ++i) {
          s[i] = arguments[i];
        }
        return slow(s);
      };
    }
    function generateOrientationProc() {
      while (CACHED.length <= NUM_EXPAND) {
        CACHED.push(orientation(CACHED.length));
      }
      module.exports = proc.apply(void 0, [slowOrient].concat(CACHED));
      for (var i = 0; i <= NUM_EXPAND; ++i) {
        module.exports[i] = CACHED[i];
      }
    }
    generateOrientationProc();
  }
});

// node_modules/monotone-convex-hull-2d/index.js
var require_monotone_convex_hull_2d = __commonJS({
  "node_modules/monotone-convex-hull-2d/index.js"(exports, module) {
    "use strict";
    module.exports = monotoneConvexHull2D;
    var orient = require_orientation()[3];
    function monotoneConvexHull2D(points) {
      var n = points.length;
      if (n < 3) {
        var result = new Array(n);
        for (var i = 0; i < n; ++i) {
          result[i] = i;
        }
        if (n === 2 && points[0][0] === points[1][0] && points[0][1] === points[1][1]) {
          return [0];
        }
        return result;
      }
      var sorted = new Array(n);
      for (var i = 0; i < n; ++i) {
        sorted[i] = i;
      }
      sorted.sort(function(a, b) {
        var d = points[a][0] - points[b][0];
        if (d) {
          return d;
        }
        return points[a][1] - points[b][1];
      });
      var lower = [sorted[0], sorted[1]];
      var upper = [sorted[0], sorted[1]];
      for (var i = 2; i < n; ++i) {
        var idx = sorted[i];
        var p = points[idx];
        var m = lower.length;
        while (m > 1 && orient(
          points[lower[m - 2]],
          points[lower[m - 1]],
          p
        ) <= 0) {
          m -= 1;
          lower.pop();
        }
        lower.push(idx);
        m = upper.length;
        while (m > 1 && orient(
          points[upper[m - 2]],
          points[upper[m - 1]],
          p
        ) >= 0) {
          m -= 1;
          upper.pop();
        }
        upper.push(idx);
      }
      var result = new Array(upper.length + lower.length - 2);
      var ptr = 0;
      for (var i = 0, nl = lower.length; i < nl; ++i) {
        result[ptr++] = lower[i];
      }
      for (var j = upper.length - 2; j > 0; --j) {
        result[ptr++] = upper[j];
      }
      return result;
    }
  }
});

// node_modules/gl-vec3/dot.js
var require_dot = __commonJS({
  "node_modules/gl-vec3/dot.js"(exports, module) {
    module.exports = dot3;
    function dot3(a, b) {
      return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    }
  }
});

// node_modules/gl-vec3/scale.js
var require_scale = __commonJS({
  "node_modules/gl-vec3/scale.js"(exports, module) {
    module.exports = scale3;
    function scale3(out, a, b) {
      out[0] = a[0] * b;
      out[1] = a[1] * b;
      out[2] = a[2] * b;
      return out;
    }
  }
});

// node_modules/gl-vec4/fromValues.js
var require_fromValues = __commonJS({
  "node_modules/gl-vec4/fromValues.js"(exports, module) {
    module.exports = fromValues2;
    function fromValues2(x, y, z, w) {
      var out = new Float32Array(4);
      out[0] = x;
      out[1] = y;
      out[2] = z;
      out[3] = w;
      return out;
    }
  }
});

// node_modules/gl-vec4/transformMat4.js
var require_transformMat4 = __commonJS({
  "node_modules/gl-vec4/transformMat4.js"(exports, module) {
    module.exports = transformMat42;
    function transformMat42(out, a, m) {
      var x = a[0], y = a[1], z = a[2], w = a[3];
      out[0] = m[0] * x + m[4] * y + m[8] * z + m[12] * w;
      out[1] = m[1] * x + m[5] * y + m[9] * z + m[13] * w;
      out[2] = m[2] * x + m[6] * y + m[10] * z + m[14] * w;
      out[3] = m[3] * x + m[7] * y + m[11] * z + m[15] * w;
      return out;
    }
  }
});

// node_modules/gl-mat4/fromRotationTranslation.js
var require_fromRotationTranslation = __commonJS({
  "node_modules/gl-mat4/fromRotationTranslation.js"(exports, module) {
    module.exports = fromRotationTranslation2;
    function fromRotationTranslation2(out, q, v) {
      var x = q[0], y = q[1], z = q[2], w = q[3], x2 = x + x, y2 = y + y, z2 = z + z, xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
      out[0] = 1 - (yy + zz);
      out[1] = xy + wz;
      out[2] = xz - wy;
      out[3] = 0;
      out[4] = xy - wz;
      out[5] = 1 - (xx + zz);
      out[6] = yz + wx;
      out[7] = 0;
      out[8] = xz + wy;
      out[9] = yz - wx;
      out[10] = 1 - (xx + yy);
      out[11] = 0;
      out[12] = v[0];
      out[13] = v[1];
      out[14] = v[2];
      out[15] = 1;
      return out;
    }
  }
});

// node_modules/gl-vec3/length.js
var require_length = __commonJS({
  "node_modules/gl-vec3/length.js"(exports, module) {
    module.exports = length;
    function length(a) {
      var x = a[0], y = a[1], z = a[2];
      return Math.sqrt(x * x + y * y + z * z);
    }
  }
});

// node_modules/gl-vec4/normalize.js
var require_normalize2 = __commonJS({
  "node_modules/gl-vec4/normalize.js"(exports, module) {
    module.exports = normalize2;
    function normalize2(out, a) {
      var x = a[0], y = a[1], z = a[2], w = a[3];
      var len = x * x + y * y + z * z + w * w;
      if (len > 0) {
        len = 1 / Math.sqrt(len);
        out[0] = x * len;
        out[1] = y * len;
        out[2] = z * len;
        out[3] = w * len;
      }
      return out;
    }
  }
});

// node_modules/gl-quat/normalize.js
var require_normalize3 = __commonJS({
  "node_modules/gl-quat/normalize.js"(exports, module) {
    module.exports = require_normalize2();
  }
});

// node_modules/gl-quat/setAxisAngle.js
var require_setAxisAngle = __commonJS({
  "node_modules/gl-quat/setAxisAngle.js"(exports, module) {
    module.exports = setAxisAngle;
    function setAxisAngle(out, axis, rad) {
      rad = rad * 0.5;
      var s = Math.sin(rad);
      out[0] = s * axis[0];
      out[1] = s * axis[1];
      out[2] = s * axis[2];
      out[3] = Math.cos(rad);
      return out;
    }
  }
});

// node_modules/gl-quat/rotationTo.js
var require_rotationTo = __commonJS({
  "node_modules/gl-quat/rotationTo.js"(exports, module) {
    var vecDot = require_dot();
    var vecCross = require_cross();
    var vecLength = require_length();
    var vecNormalize = require_normalize();
    var quatNormalize = require_normalize3();
    var quatAxisAngle = require_setAxisAngle();
    module.exports = rotationTo2;
    var tmpvec3 = [0, 0, 0];
    var xUnitVec3 = [1, 0, 0];
    var yUnitVec3 = [0, 1, 0];
    function rotationTo2(out, a, b) {
      var dot3 = vecDot(a, b);
      if (dot3 < -0.999999) {
        vecCross(tmpvec3, xUnitVec3, a);
        if (vecLength(tmpvec3) < 1e-6) {
          vecCross(tmpvec3, yUnitVec3, a);
        }
        vecNormalize(tmpvec3, tmpvec3);
        quatAxisAngle(out, tmpvec3, Math.PI);
        return out;
      } else if (dot3 > 0.999999) {
        out[0] = 0;
        out[1] = 0;
        out[2] = 0;
        out[3] = 1;
        return out;
      } else {
        vecCross(tmpvec3, a, b);
        out[0] = tmpvec3[0];
        out[1] = tmpvec3[1];
        out[2] = tmpvec3[2];
        out[3] = 1 + dot3;
        return quatNormalize(out, out);
      }
    }
  }
});

// node_modules/ms/index.js
var require_ms = __commonJS({
  "node_modules/ms/index.js"(exports, module) {
    var s = 1e3;
    var m = s * 60;
    var h = m * 60;
    var d = h * 24;
    var w = d * 7;
    var y = d * 365.25;
    module.exports = function(val, options) {
      options = options || {};
      var type = typeof val;
      if (type === "string" && val.length > 0) {
        return parse(val);
      } else if (type === "number" && isFinite(val)) {
        return options.long ? fmtLong(val) : fmtShort(val);
      }
      throw new Error(
        "val is not a non-empty string or a valid number. val=" + JSON.stringify(val)
      );
    };
    function parse(str) {
      str = String(str);
      if (str.length > 100) {
        return;
      }
      var match = /^(-?(?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$/i.exec(
        str
      );
      if (!match) {
        return;
      }
      var n = parseFloat(match[1]);
      var type = (match[2] || "ms").toLowerCase();
      switch (type) {
        case "years":
        case "year":
        case "yrs":
        case "yr":
        case "y":
          return n * y;
        case "weeks":
        case "week":
        case "w":
          return n * w;
        case "days":
        case "day":
        case "d":
          return n * d;
        case "hours":
        case "hour":
        case "hrs":
        case "hr":
        case "h":
          return n * h;
        case "minutes":
        case "minute":
        case "mins":
        case "min":
        case "m":
          return n * m;
        case "seconds":
        case "second":
        case "secs":
        case "sec":
        case "s":
          return n * s;
        case "milliseconds":
        case "millisecond":
        case "msecs":
        case "msec":
        case "ms":
          return n;
        default:
          return void 0;
      }
    }
    function fmtShort(ms) {
      var msAbs = Math.abs(ms);
      if (msAbs >= d) {
        return Math.round(ms / d) + "d";
      }
      if (msAbs >= h) {
        return Math.round(ms / h) + "h";
      }
      if (msAbs >= m) {
        return Math.round(ms / m) + "m";
      }
      if (msAbs >= s) {
        return Math.round(ms / s) + "s";
      }
      return ms + "ms";
    }
    function fmtLong(ms) {
      var msAbs = Math.abs(ms);
      if (msAbs >= d) {
        return plural(ms, msAbs, d, "day");
      }
      if (msAbs >= h) {
        return plural(ms, msAbs, h, "hour");
      }
      if (msAbs >= m) {
        return plural(ms, msAbs, m, "minute");
      }
      if (msAbs >= s) {
        return plural(ms, msAbs, s, "second");
      }
      return ms + " ms";
    }
    function plural(ms, msAbs, n, name) {
      var isPlural = msAbs >= n * 1.5;
      return Math.round(ms / n) + " " + name + (isPlural ? "s" : "");
    }
  }
});

// node_modules/debug/src/common.js
var require_common = __commonJS({
  "node_modules/debug/src/common.js"(exports, module) {
    function setup(env) {
      createDebug.debug = createDebug;
      createDebug.default = createDebug;
      createDebug.coerce = coerce;
      createDebug.disable = disable;
      createDebug.enable = enable;
      createDebug.enabled = enabled;
      createDebug.humanize = require_ms();
      createDebug.destroy = destroy;
      Object.keys(env).forEach((key) => {
        createDebug[key] = env[key];
      });
      createDebug.names = [];
      createDebug.skips = [];
      createDebug.formatters = {};
      function selectColor(namespace) {
        let hash = 0;
        for (let i = 0; i < namespace.length; i++) {
          hash = (hash << 5) - hash + namespace.charCodeAt(i);
          hash |= 0;
        }
        return createDebug.colors[Math.abs(hash) % createDebug.colors.length];
      }
      createDebug.selectColor = selectColor;
      function createDebug(namespace) {
        let prevTime;
        let enableOverride = null;
        let namespacesCache;
        let enabledCache;
        function debug4(...args) {
          if (!debug4.enabled) {
            return;
          }
          const self = debug4;
          const curr = Number(/* @__PURE__ */ new Date());
          const ms = curr - (prevTime || curr);
          self.diff = ms;
          self.prev = prevTime;
          self.curr = curr;
          prevTime = curr;
          args[0] = createDebug.coerce(args[0]);
          if (typeof args[0] !== "string") {
            args.unshift("%O");
          }
          let index = 0;
          args[0] = args[0].replace(/%([a-zA-Z%])/g, (match, format) => {
            if (match === "%%") {
              return "%";
            }
            index++;
            const formatter = createDebug.formatters[format];
            if (typeof formatter === "function") {
              const val = args[index];
              match = formatter.call(self, val);
              args.splice(index, 1);
              index--;
            }
            return match;
          });
          createDebug.formatArgs.call(self, args);
          const logFn = self.log || createDebug.log;
          logFn.apply(self, args);
        }
        debug4.namespace = namespace;
        debug4.useColors = createDebug.useColors();
        debug4.color = createDebug.selectColor(namespace);
        debug4.extend = extend;
        debug4.destroy = createDebug.destroy;
        Object.defineProperty(debug4, "enabled", {
          enumerable: true,
          configurable: false,
          get: () => {
            if (enableOverride !== null) {
              return enableOverride;
            }
            if (namespacesCache !== createDebug.namespaces) {
              namespacesCache = createDebug.namespaces;
              enabledCache = createDebug.enabled(namespace);
            }
            return enabledCache;
          },
          set: (v) => {
            enableOverride = v;
          }
        });
        if (typeof createDebug.init === "function") {
          createDebug.init(debug4);
        }
        return debug4;
      }
      function extend(namespace, delimiter) {
        const newDebug = createDebug(this.namespace + (typeof delimiter === "undefined" ? ":" : delimiter) + namespace);
        newDebug.log = this.log;
        return newDebug;
      }
      function enable(namespaces) {
        createDebug.save(namespaces);
        createDebug.namespaces = namespaces;
        createDebug.names = [];
        createDebug.skips = [];
        const split = (typeof namespaces === "string" ? namespaces : "").trim().replace(/\s+/g, ",").split(",").filter(Boolean);
        for (const ns of split) {
          if (ns[0] === "-") {
            createDebug.skips.push(ns.slice(1));
          } else {
            createDebug.names.push(ns);
          }
        }
      }
      function matchesTemplate(search, template) {
        let searchIndex = 0;
        let templateIndex = 0;
        let starIndex = -1;
        let matchIndex = 0;
        while (searchIndex < search.length) {
          if (templateIndex < template.length && (template[templateIndex] === search[searchIndex] || template[templateIndex] === "*")) {
            if (template[templateIndex] === "*") {
              starIndex = templateIndex;
              matchIndex = searchIndex;
              templateIndex++;
            } else {
              searchIndex++;
              templateIndex++;
            }
          } else if (starIndex !== -1) {
            templateIndex = starIndex + 1;
            matchIndex++;
            searchIndex = matchIndex;
          } else {
            return false;
          }
        }
        while (templateIndex < template.length && template[templateIndex] === "*") {
          templateIndex++;
        }
        return templateIndex === template.length;
      }
      function disable() {
        const namespaces = [
          ...createDebug.names,
          ...createDebug.skips.map((namespace) => "-" + namespace)
        ].join(",");
        createDebug.enable("");
        return namespaces;
      }
      function enabled(name) {
        for (const skip of createDebug.skips) {
          if (matchesTemplate(name, skip)) {
            return false;
          }
        }
        for (const ns of createDebug.names) {
          if (matchesTemplate(name, ns)) {
            return true;
          }
        }
        return false;
      }
      function coerce(val) {
        if (val instanceof Error) {
          return val.stack || val.message;
        }
        return val;
      }
      function destroy() {
        console.warn("Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`.");
      }
      createDebug.enable(createDebug.load());
      return createDebug;
    }
    module.exports = setup;
  }
});

// node_modules/debug/src/browser.js
var require_browser = __commonJS({
  "node_modules/debug/src/browser.js"(exports, module) {
    exports.formatArgs = formatArgs;
    exports.save = save;
    exports.load = load;
    exports.useColors = useColors;
    exports.storage = localstorage();
    exports.destroy = /* @__PURE__ */ (() => {
      let warned = false;
      return () => {
        if (!warned) {
          warned = true;
          console.warn("Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`.");
        }
      };
    })();
    exports.colors = [
      "#0000CC",
      "#0000FF",
      "#0033CC",
      "#0033FF",
      "#0066CC",
      "#0066FF",
      "#0099CC",
      "#0099FF",
      "#00CC00",
      "#00CC33",
      "#00CC66",
      "#00CC99",
      "#00CCCC",
      "#00CCFF",
      "#3300CC",
      "#3300FF",
      "#3333CC",
      "#3333FF",
      "#3366CC",
      "#3366FF",
      "#3399CC",
      "#3399FF",
      "#33CC00",
      "#33CC33",
      "#33CC66",
      "#33CC99",
      "#33CCCC",
      "#33CCFF",
      "#6600CC",
      "#6600FF",
      "#6633CC",
      "#6633FF",
      "#66CC00",
      "#66CC33",
      "#9900CC",
      "#9900FF",
      "#9933CC",
      "#9933FF",
      "#99CC00",
      "#99CC33",
      "#CC0000",
      "#CC0033",
      "#CC0066",
      "#CC0099",
      "#CC00CC",
      "#CC00FF",
      "#CC3300",
      "#CC3333",
      "#CC3366",
      "#CC3399",
      "#CC33CC",
      "#CC33FF",
      "#CC6600",
      "#CC6633",
      "#CC9900",
      "#CC9933",
      "#CCCC00",
      "#CCCC33",
      "#FF0000",
      "#FF0033",
      "#FF0066",
      "#FF0099",
      "#FF00CC",
      "#FF00FF",
      "#FF3300",
      "#FF3333",
      "#FF3366",
      "#FF3399",
      "#FF33CC",
      "#FF33FF",
      "#FF6600",
      "#FF6633",
      "#FF9900",
      "#FF9933",
      "#FFCC00",
      "#FFCC33"
    ];
    function useColors() {
      if (typeof window !== "undefined" && window.process && (window.process.type === "renderer" || window.process.__nwjs)) {
        return true;
      }
      if (typeof navigator !== "undefined" && navigator.userAgent && navigator.userAgent.toLowerCase().match(/(edge|trident)\/(\d+)/)) {
        return false;
      }
      let m;
      return typeof document !== "undefined" && document.documentElement && document.documentElement.style && document.documentElement.style.WebkitAppearance || // Is firebug? http://stackoverflow.com/a/398120/376773
      typeof window !== "undefined" && window.console && (window.console.firebug || window.console.exception && window.console.table) || // Is firefox >= v31?
      // https://developer.mozilla.org/en-US/docs/Tools/Web_Console#Styling_messages
      typeof navigator !== "undefined" && navigator.userAgent && (m = navigator.userAgent.toLowerCase().match(/firefox\/(\d+)/)) && parseInt(m[1], 10) >= 31 || // Double check webkit in userAgent just in case we are in a worker
      typeof navigator !== "undefined" && navigator.userAgent && navigator.userAgent.toLowerCase().match(/applewebkit\/(\d+)/);
    }
    function formatArgs(args) {
      args[0] = (this.useColors ? "%c" : "") + this.namespace + (this.useColors ? " %c" : " ") + args[0] + (this.useColors ? "%c " : " ") + "+" + module.exports.humanize(this.diff);
      if (!this.useColors) {
        return;
      }
      const c = "color: " + this.color;
      args.splice(1, 0, c, "color: inherit");
      let index = 0;
      let lastC = 0;
      args[0].replace(/%[a-zA-Z%]/g, (match) => {
        if (match === "%%") {
          return;
        }
        index++;
        if (match === "%c") {
          lastC = index;
        }
      });
      args.splice(lastC, 0, c);
    }
    exports.log = console.debug || console.log || (() => {
    });
    function save(namespaces) {
      try {
        if (namespaces) {
          exports.storage.setItem("debug", namespaces);
        } else {
          exports.storage.removeItem("debug");
        }
      } catch (error) {
      }
    }
    function load() {
      let r;
      try {
        r = exports.storage.getItem("debug") || exports.storage.getItem("DEBUG");
      } catch (error) {
      }
      if (!r && typeof process !== "undefined" && "env" in process) {
        r = process.env.DEBUG;
      }
      return r;
    }
    function localstorage() {
      // [shapemaker patch] Stubbed. The bundled `debug` dependency probes
      // global localStorage at load, which triggers Node's ExperimentalWarning
      // in every test/acceptance run. Debug logging is unused here.
      // Documented in vendor/quickhull3d/README.md — reapply after rebundling.
      return void 0;
    }
    module.exports = require_common()(exports);
    var { formatters } = module.exports;
    formatters.j = function(v) {
      try {
        return JSON.stringify(v);
      } catch (error) {
        return "[UnexpectedJSONParseError]: " + error.message;
      }
    };
  }
});

// node_modules/gl-vec3/add.js
var require_add = __commonJS({
  "node_modules/gl-vec3/add.js"(exports, module) {
    module.exports = add2;
    function add2(out, a, b) {
      out[0] = a[0] + b[0];
      out[1] = a[1] + b[1];
      out[2] = a[2] + b[2];
      return out;
    }
  }
});

// node_modules/gl-vec3/copy.js
var require_copy = __commonJS({
  "node_modules/gl-vec3/copy.js"(exports, module) {
    module.exports = copy2;
    function copy2(out, a) {
      out[0] = a[0];
      out[1] = a[1];
      out[2] = a[2];
      return out;
    }
  }
});

// node_modules/gl-vec3/scaleAndAdd.js
var require_scaleAndAdd = __commonJS({
  "node_modules/gl-vec3/scaleAndAdd.js"(exports, module) {
    module.exports = scaleAndAdd2;
    function scaleAndAdd2(out, a, b, scale3) {
      out[0] = a[0] + b[0] * scale3;
      out[1] = a[1] + b[1] * scale3;
      out[2] = a[2] + b[2] * scale3;
      return out;
    }
  }
});

// node_modules/gl-vec3/distance.js
var require_distance = __commonJS({
  "node_modules/gl-vec3/distance.js"(exports, module) {
    module.exports = distance2;
    function distance2(a, b) {
      var x = b[0] - a[0], y = b[1] - a[1], z = b[2] - a[2];
      return Math.sqrt(x * x + y * y + z * z);
    }
  }
});

// node_modules/gl-vec3/squaredDistance.js
var require_squaredDistance = __commonJS({
  "node_modules/gl-vec3/squaredDistance.js"(exports, module) {
    module.exports = squaredDistance2;
    function squaredDistance2(a, b) {
      var x = b[0] - a[0], y = b[1] - a[1], z = b[2] - a[2];
      return x * x + y * y + z * z;
    }
  }
});

// node_modules/quickhull3d/dist/index.js
var import_get_plane_normal2 = __toESM(require_get_plane_normal(), 1);

// node_modules/quickhull3d/dist/QuickHull.js
var import_point_line_distance = __toESM(require_point_line_distance(), 1);
var import_get_plane_normal = __toESM(require_get_plane_normal(), 1);
var import_monotone_convex_hull_2d = __toESM(require_monotone_convex_hull_2d(), 1);
var import_dot2 = __toESM(require_dot(), 1);
var import_scale2 = __toESM(require_scale(), 1);
var import_fromValues = __toESM(require_fromValues(), 1);
var import_transformMat4 = __toESM(require_transformMat4(), 1);
var import_fromRotationTranslation = __toESM(require_fromRotationTranslation(), 1);
var import_rotationTo = __toESM(require_rotationTo(), 1);
var import_debug3 = __toESM(require_browser(), 1);

// node_modules/quickhull3d/dist/VertexList.js
var VertexList = class {
  head;
  tail;
  constructor() {
    this.head = null;
    this.tail = null;
  }
  clear() {
    this.head = this.tail = null;
  }
  /**
   * Inserts a `node` before `target`, it's assumed that
   * `target` belongs to this doubly linked list
   *
   * @param {Vertex} target
   * @param {Vertex} node
   */
  insertBefore(target, node) {
    node.prev = target.prev;
    node.next = target;
    if (!node.prev) {
      this.head = node;
    } else {
      node.prev.next = node;
    }
    target.prev = node;
  }
  /**
   * Inserts a `node` after `target`, it's assumed that
   * `target` belongs to this doubly linked list
   *
   * @param {Vertex} target
   * @param {Vertex} node
   */
  insertAfter(target, node) {
    node.prev = target;
    node.next = target.next;
    if (!node.next) {
      this.tail = node;
    } else {
      node.next.prev = node;
    }
    target.next = node;
  }
  /**
   * Appends a `node` to the end of this doubly linked list
   * Note: `node.next` will be unlinked from `node`
   * Note: if `node` is part of another linked list call `addAll` instead
   *
   * @param {Vertex} node
   */
  add(node) {
    if (!this.head) {
      this.head = node;
    } else {
      this.tail.next = node;
    }
    node.prev = this.tail;
    node.next = null;
    this.tail = node;
  }
  /**
   * Appends a chain of nodes where `node` is the head,
   * the difference with `add` is that it correctly sets the position
   * of the node list `tail` property
   *
   * @param {Vertex} node
   */
  addAll(node) {
    if (!this.head) {
      this.head = node;
    } else {
      this.tail.next = node;
    }
    node.prev = this.tail;
    while (node.next) {
      node = node.next;
    }
    this.tail = node;
  }
  /**
   * Deletes a `node` from this linked list, it's assumed that `node` is a
   * member of this linked list
   *
   * @param {Vertex} node
   */
  remove(node) {
    if (!node.prev) {
      this.head = node.next;
    } else {
      node.prev.next = node.next;
    }
    if (!node.next) {
      this.tail = node.prev;
    } else {
      node.next.prev = node.prev;
    }
  }
  /**
   * Removes a chain of nodes whose head is `a` and whose tail is `b`,
   * it's assumed that `a` and `b` belong to this list and also that `a`
   * comes before `b` in the linked list
   *
   * @param {Vertex} a
   * @param {Vertex} b
   */
  removeChain(a, b) {
    if (!a.prev) {
      this.head = b.next;
    } else {
      a.prev.next = b.next;
    }
    if (!b.next) {
      this.tail = a.prev;
    } else {
      b.next.prev = a.prev;
    }
  }
  first() {
    return this.head;
  }
  isEmpty() {
    return !this.head;
  }
};

// node_modules/quickhull3d/dist/Vertex.js
var Vertex = class {
  point;
  // index in the input array
  index;
  // next is a pointer to the next Vertex
  next;
  // prev is a pointer to the previous Vertex
  prev;
  // face is the face that's able to see this point
  face;
  constructor(point, index) {
    this.point = point;
    this.index = index;
    this.next = null;
    this.prev = null;
    this.face = null;
  }
};

// node_modules/quickhull3d/dist/Face.js
var import_dot = __toESM(require_dot(), 1);
var import_add = __toESM(require_add(), 1);
var import_subtract = __toESM(require_subtract(), 1);
var import_cross = __toESM(require_cross(), 1);
var import_copy = __toESM(require_copy(), 1);
var import_length = __toESM(require_length(), 1);
var import_scale = __toESM(require_scale(), 1);
var import_scaleAndAdd = __toESM(require_scaleAndAdd(), 1);
var import_normalize = __toESM(require_normalize(), 1);
var import_debug2 = __toESM(require_browser(), 1);

// node_modules/quickhull3d/dist/HalfEdge.js
var import_distance = __toESM(require_distance(), 1);
var import_squaredDistance = __toESM(require_squaredDistance(), 1);
var import_debug = __toESM(require_browser(), 1);
var debug = (0, import_debug.default)("quickhull3d:halfedge");
var HalfEdge = class {
  vertex;
  face;
  next;
  prev;
  opposite;
  constructor(vertex, face) {
    this.vertex = vertex;
    this.face = face;
    this.next = null;
    this.prev = null;
    this.opposite = null;
  }
  head() {
    return this.vertex;
  }
  tail() {
    return this.prev ? this.prev.vertex : null;
  }
  length() {
    if (this.tail()) {
      return (0, import_distance.default)(this.tail().point, this.head().point);
    }
    return -1;
  }
  lengthSquared() {
    if (this.tail()) {
      return (0, import_squaredDistance.default)(this.tail().point, this.head().point);
    }
    return -1;
  }
  setOpposite(edge) {
    const me = this;
    if (debug.enabled) {
      debug(`opposite ${me.tail().index} <--> ${me.head().index} between ${me.face.collectIndices()}, ${edge.face.collectIndices()}`);
    }
    this.opposite = edge;
    edge.opposite = this;
  }
};

// node_modules/quickhull3d/dist/Face.js
var debug2 = (0, import_debug2.default)("quickhull3d:face");
var Mark;
(function(Mark2) {
  Mark2[Mark2["Visible"] = 0] = "Visible";
  Mark2[Mark2["NonConvex"] = 1] = "NonConvex";
  Mark2[Mark2["Deleted"] = 2] = "Deleted";
})(Mark || (Mark = {}));
var Face = class _Face {
  normal;
  centroid;
  offset;
  outside;
  mark;
  edge;
  nVertices;
  area;
  constructor() {
    this.normal = [0, 0, 0];
    this.centroid = [0, 0, 0];
    this.offset = 0;
    this.outside = null;
    this.mark = Mark.Visible;
    this.edge = null;
    this.nVertices = 0;
  }
  getEdge(i) {
    let it = this.edge;
    while (i > 0) {
      it = it.next;
      i -= 1;
    }
    while (i < 0) {
      it = it.prev;
      i += 1;
    }
    return it;
  }
  computeNormal() {
    const e0 = this.edge;
    const e1 = e0.next;
    let e2 = e1.next;
    const v2 = (0, import_subtract.default)([], e1.head().point, e0.head().point);
    const t = [];
    const v1 = [];
    this.nVertices = 2;
    this.normal = [0, 0, 0];
    while (e2 !== e0) {
      (0, import_copy.default)(v1, v2);
      (0, import_subtract.default)(v2, e2.head().point, e0.head().point);
      (0, import_add.default)(this.normal, this.normal, (0, import_cross.default)(t, v1, v2));
      e2 = e2.next;
      this.nVertices += 1;
    }
    this.area = (0, import_length.default)(this.normal);
    this.normal = (0, import_scale.default)(this.normal, this.normal, 1 / this.area);
  }
  computeNormalMinArea(minArea) {
    this.computeNormal();
    if (this.area < minArea) {
      let maxEdge;
      let maxSquaredLength = 0;
      let edge = this.edge;
      do {
        const lengthSquared = edge.lengthSquared();
        if (lengthSquared > maxSquaredLength) {
          maxEdge = edge;
          maxSquaredLength = lengthSquared;
        }
        edge = edge.next;
      } while (edge !== this.edge);
      const p1 = maxEdge.tail().point;
      const p2 = maxEdge.head().point;
      const maxVector = (0, import_subtract.default)([], p2, p1);
      const maxLength = Math.sqrt(maxSquaredLength);
      (0, import_scale.default)(maxVector, maxVector, 1 / maxLength);
      const maxProjection = (0, import_dot.default)(this.normal, maxVector);
      (0, import_scaleAndAdd.default)(this.normal, this.normal, maxVector, -maxProjection);
      (0, import_normalize.default)(this.normal, this.normal);
    }
  }
  computeCentroid() {
    this.centroid = [0, 0, 0];
    let edge = this.edge;
    do {
      (0, import_add.default)(this.centroid, this.centroid, edge.head().point);
      edge = edge.next;
    } while (edge !== this.edge);
    (0, import_scale.default)(this.centroid, this.centroid, 1 / this.nVertices);
  }
  computeNormalAndCentroid(minArea) {
    if (typeof minArea !== "undefined") {
      this.computeNormalMinArea(minArea);
    } else {
      this.computeNormal();
    }
    this.computeCentroid();
    this.offset = (0, import_dot.default)(this.normal, this.centroid);
  }
  distanceToPlane(point) {
    return (0, import_dot.default)(this.normal, point) - this.offset;
  }
  /**
   * @private
   *
   * Connects two edges assuming that prev.head().point === next.tail().point
   *
   * @param {HalfEdge} prev
   * @param {HalfEdge} next
   */
  connectHalfEdges(prev, next) {
    let discardedFace;
    if (prev.opposite.face === next.opposite.face) {
      const oppositeFace = next.opposite.face;
      let oppositeEdge;
      if (prev === this.edge) {
        this.edge = next;
      }
      if (oppositeFace.nVertices === 3) {
        oppositeEdge = next.opposite.prev.opposite;
        oppositeFace.mark = Mark.Deleted;
        discardedFace = oppositeFace;
      } else {
        oppositeEdge = next.opposite.next;
        if (oppositeFace.edge === oppositeEdge.prev) {
          oppositeFace.edge = oppositeEdge;
        }
        oppositeEdge.prev = oppositeEdge.prev.prev;
        oppositeEdge.prev.next = oppositeEdge;
      }
      next.prev = prev.prev;
      next.prev.next = next;
      next.setOpposite(oppositeEdge);
      oppositeFace.computeNormalAndCentroid();
    } else {
      prev.next = next;
      next.prev = prev;
    }
    return discardedFace;
  }
  mergeAdjacentFaces(adjacentEdge, discardedFaces) {
    const oppositeEdge = adjacentEdge.opposite;
    const oppositeFace = oppositeEdge.face;
    discardedFaces.push(oppositeFace);
    oppositeFace.mark = Mark.Deleted;
    let adjacentEdgePrev = adjacentEdge.prev;
    let adjacentEdgeNext = adjacentEdge.next;
    let oppositeEdgePrev = oppositeEdge.prev;
    let oppositeEdgeNext = oppositeEdge.next;
    while (adjacentEdgePrev.opposite.face === oppositeFace) {
      adjacentEdgePrev = adjacentEdgePrev.prev;
      oppositeEdgeNext = oppositeEdgeNext.next;
    }
    while (adjacentEdgeNext.opposite.face === oppositeFace) {
      adjacentEdgeNext = adjacentEdgeNext.next;
      oppositeEdgePrev = oppositeEdgePrev.prev;
    }
    let edge;
    for (edge = oppositeEdgeNext; edge !== oppositeEdgePrev.next; edge = edge.next) {
      edge.face = this;
    }
    this.edge = adjacentEdgeNext;
    let discardedFace;
    discardedFace = this.connectHalfEdges(oppositeEdgePrev, adjacentEdgeNext);
    if (discardedFace) {
      discardedFaces.push(discardedFace);
    }
    discardedFace = this.connectHalfEdges(adjacentEdgePrev, oppositeEdgeNext);
    if (discardedFace) {
      discardedFaces.push(discardedFace);
    }
    this.computeNormalAndCentroid();
    return discardedFaces;
  }
  collectIndices() {
    const indices = [];
    let edge = this.edge;
    do {
      indices.push(edge.head().index);
      edge = edge.next;
    } while (edge !== this.edge);
    return indices;
  }
  static fromVertices(vertices, minArea = 0) {
    const face = new _Face();
    const e0 = new HalfEdge(vertices[0], face);
    let lastE = e0;
    for (let i = 1; i < vertices.length; i += 1) {
      const e = new HalfEdge(vertices[i], face);
      e.prev = lastE;
      lastE.next = e;
      lastE = e;
    }
    lastE.next = e0;
    e0.prev = lastE;
    face.edge = e0;
    face.computeNormalAndCentroid(minArea);
    if (debug2.enabled) {
      debug2("face created %j", face.collectIndices());
    }
    return face;
  }
  static createTriangle(v0, v1, v2, minArea = 0) {
    const face = new _Face();
    const e0 = new HalfEdge(v0, face);
    const e1 = new HalfEdge(v1, face);
    const e2 = new HalfEdge(v2, face);
    e0.next = e2.prev = e1;
    e1.next = e0.prev = e2;
    e2.next = e1.prev = e0;
    face.edge = e0;
    face.computeNormalAndCentroid(minArea);
    if (debug2.enabled) {
      debug2("face created %j", face.collectIndices());
    }
    return face;
  }
};

// node_modules/quickhull3d/dist/QuickHull.js
var debug3 = (0, import_debug3.default)("quickhull3d:quickhull");
var MergeType;
(function(MergeType2) {
  MergeType2[MergeType2["NonConvexWrtLargerFace"] = 0] = "NonConvexWrtLargerFace";
  MergeType2[MergeType2["NonConvex"] = 1] = "NonConvex";
})(MergeType || (MergeType = {}));
var QuickHullOptions = class {
  skipTriangulation;
};
var QuickHull = class {
  // tolerance is the computed tolerance used for the merge.
  tolerance;
  // faces are the faces of the hull.
  faces;
  // newFaces are the new faces in an iteration of the quickhull algorithm.
  newFaces;
  // claimed are the vertices that have been claimed.
  claimed;
  // unclaimed are the vertices that haven't been claimed.
  unclaimed;
  // vertices are the points of the hull.
  vertices;
  discardedFaces;
  vertexPointIndices;
  constructor(points) {
    if (!Array.isArray(points)) {
      throw TypeError("input is not a valid array");
    }
    if (points.length < 4) {
      throw Error("cannot build a simplex out of <4 points");
    }
    this.tolerance = -1;
    this.faces = [];
    this.newFaces = [];
    this.claimed = new VertexList();
    this.unclaimed = new VertexList();
    this.vertices = [];
    for (let i = 0; i < points.length; i += 1) {
      this.vertices.push(new Vertex(points[i], i));
    }
    this.discardedFaces = [];
    this.vertexPointIndices = [];
  }
  addVertexToFace(vertex, face) {
    vertex.face = face;
    if (!face.outside) {
      this.claimed.add(vertex);
    } else {
      this.claimed.insertBefore(face.outside, vertex);
    }
    face.outside = vertex;
  }
  /**
   * Removes `vertex` for the `claimed` list of vertices, it also makes sure
   * that the link from `face` to the first vertex it sees in `claimed` is
   * linked correctly after the removal
   *
   * @param {Vertex} vertex
   * @param {Face} face
   */
  removeVertexFromFace(vertex, face) {
    if (vertex === face.outside) {
      if (vertex.next && vertex.next.face === face) {
        face.outside = vertex.next;
      } else {
        face.outside = null;
      }
    }
    this.claimed.remove(vertex);
  }
  /**
   * Removes all the visible vertices that `face` is able to see which are
   * stored in the `claimed` vertext list
   *
   * @param {Face} face
   */
  removeAllVerticesFromFace(face) {
    if (face.outside) {
      let end = face.outside;
      while (end.next && end.next.face === face) {
        end = end.next;
      }
      this.claimed.removeChain(face.outside, end);
      end.next = null;
      return face.outside;
    }
  }
  /**
   * Removes all the visible vertices that `face` is able to see, additionally
   * checking the following:
   *
   * If `absorbingFace` doesn't exist then all the removed vertices will be
   * added to the `unclaimed` vertex list
   *
   * If `absorbingFace` exists then this method will assign all the vertices of
   * `face` that can see `absorbingFace`, if a vertex cannot see `absorbingFace`
   * it's added to the `unclaimed` vertex list
   *
   * @param {Face} face
   * @param {Face} [absorbingFace]
   */
  deleteFaceVertices(face, absorbingFace) {
    const faceVertices = this.removeAllVerticesFromFace(face);
    if (faceVertices) {
      if (!absorbingFace) {
        this.unclaimed.addAll(faceVertices);
      } else {
        let nextVertex;
        for (let vertex = faceVertices; vertex; vertex = nextVertex) {
          nextVertex = vertex.next;
          const distance2 = absorbingFace.distanceToPlane(vertex.point);
          if (distance2 > this.tolerance) {
            this.addVertexToFace(vertex, absorbingFace);
          } else {
            this.unclaimed.add(vertex);
          }
        }
      }
    }
  }
  /**
   * Reassigns as many vertices as possible from the unclaimed list to the new
   * faces
   *
   * @param {Faces[]} newFaces
   */
  resolveUnclaimedPoints(newFaces) {
    let vertexNext = this.unclaimed.first();
    for (let vertex = vertexNext; vertex; vertex = vertexNext) {
      vertexNext = vertex.next;
      let maxDistance = this.tolerance;
      let maxFace;
      for (let i = 0; i < newFaces.length; i += 1) {
        const face = newFaces[i];
        if (face.mark === Mark.Visible) {
          const dist = face.distanceToPlane(vertex.point);
          if (dist > maxDistance) {
            maxDistance = dist;
            maxFace = face;
          }
          if (maxDistance > 1e3 * this.tolerance) {
            break;
          }
        }
      }
      if (maxFace) {
        this.addVertexToFace(vertex, maxFace);
      }
    }
  }
  /**
   * Checks if all the points belong to a plane (2d degenerate case)
   */
  allPointsBelongToPlane(v0, v1, v2) {
    const normal = (0, import_get_plane_normal.default)([0, 0, 0], v0.point, v1.point, v2.point);
    const distToPlane = (0, import_dot2.default)(normal, v0.point);
    for (const vertex of this.vertices) {
      const dist = (0, import_dot2.default)(vertex.point, normal);
      if (Math.abs(dist - distToPlane) > this.tolerance) {
        return false;
      }
    }
    return true;
  }
  /**
   * Computes the convex hull of a plane.
   */
  convexHull2d(v0, v1, v2) {
    const planeNormal = (0, import_get_plane_normal.default)([0, 0, 0], v0.point, v1.point, v2.point);
    let basisPlaneNormal = [0, 1, 0];
    const rotation = (0, import_rotationTo.default)([], planeNormal, basisPlaneNormal);
    const translation = (0, import_scale2.default)([], planeNormal, -(0, import_dot2.default)(v0.point, planeNormal));
    const matrix = (0, import_fromRotationTranslation.default)([], rotation, translation);
    const transformedVertices = [];
    for (const vertex of this.vertices) {
      const a = (0, import_fromValues.default)(vertex.point[0], vertex.point[1], vertex.point[2], 0);
      const aP = (0, import_transformMat4.default)([], a, matrix);
      if (debug3.enabled) {
        if (aP[1] > this.tolerance) {
          debug3(`ERROR: point ${aP} has an unexpected y value, it should be less than ${this.tolerance}`);
        }
      }
      transformedVertices.push([aP[0], aP[2]]);
    }
    const hull = (0, import_monotone_convex_hull_2d.default)(transformedVertices);
    const vertices = [];
    for (const i of hull) {
      vertices.push(this.vertices[i]);
    }
    const face = Face.fromVertices(vertices);
    this.faces = [face];
  }
  /**
   * Computes the extremes of a tetrahedron which will be the initial hull
   */
  computeTetrahedronExtremes() {
    const me = this;
    const min = [];
    const max = [];
    const minVertices = [];
    const maxVertices = [];
    for (let i = 0; i < 3; i += 1) {
      minVertices[i] = maxVertices[i] = this.vertices[0];
    }
    for (let i = 0; i < 3; i += 1) {
      min[i] = max[i] = this.vertices[0].point[i];
    }
    for (let i = 1; i < this.vertices.length; i += 1) {
      const vertex = this.vertices[i];
      const point = vertex.point;
      for (let j = 0; j < 3; j += 1) {
        if (point[j] < min[j]) {
          min[j] = point[j];
          minVertices[j] = vertex;
        }
      }
      for (let j = 0; j < 3; j += 1) {
        if (point[j] > max[j]) {
          max[j] = point[j];
          maxVertices[j] = vertex;
        }
      }
    }
    this.tolerance = 3 * Number.EPSILON * (Math.max(Math.abs(min[0]), Math.abs(max[0])) + Math.max(Math.abs(min[1]), Math.abs(max[1])) + Math.max(Math.abs(min[2]), Math.abs(max[2])));
    if (debug3.enabled) {
      debug3("tolerance %d", me.tolerance);
    }
    let maxDistance = 0;
    let indexMax = 0;
    for (let i = 0; i < 3; i += 1) {
      const distance2 = maxVertices[i].point[i] - minVertices[i].point[i];
      if (distance2 > maxDistance) {
        maxDistance = distance2;
        indexMax = i;
      }
    }
    const v0 = minVertices[indexMax];
    const v1 = maxVertices[indexMax];
    let v2, v3;
    maxDistance = 0;
    for (let i = 0; i < this.vertices.length; i += 1) {
      const vertex = this.vertices[i];
      if (vertex !== v0 && vertex !== v1) {
        const distance2 = (0, import_point_line_distance.default)(vertex.point, v0.point, v1.point);
        if (distance2 > maxDistance) {
          maxDistance = distance2;
          v2 = vertex;
        }
      }
    }
    const normal = (0, import_get_plane_normal.default)([0, 0, 0], v0.point, v1.point, v2.point);
    const distPO = (0, import_dot2.default)(v0.point, normal);
    maxDistance = -1;
    for (let i = 0; i < this.vertices.length; i += 1) {
      const vertex = this.vertices[i];
      if (vertex !== v0 && vertex !== v1 && vertex !== v2) {
        const distance2 = Math.abs((0, import_dot2.default)(normal, vertex.point) - distPO);
        if (distance2 > maxDistance) {
          maxDistance = distance2;
          v3 = vertex;
        }
      }
    }
    return [v0, v1, v2, v3];
  }
  /**
   * Compues the initial tetrahedron assigning to its faces all the points that
   * are candidates to form part of the hull
   */
  createInitialSimplex(v0, v1, v2, v3) {
    const normal = (0, import_get_plane_normal.default)([0, 0, 0], v0.point, v1.point, v2.point);
    const distPO = (0, import_dot2.default)(v0.point, normal);
    const faces = [];
    if ((0, import_dot2.default)(v3.point, normal) - distPO < 0) {
      faces.push(Face.createTriangle(v0, v1, v2), Face.createTriangle(v3, v1, v0), Face.createTriangle(v3, v2, v1), Face.createTriangle(v3, v0, v2));
      for (let i = 0; i < 3; i += 1) {
        const j = (i + 1) % 3;
        faces[i + 1].getEdge(2).setOpposite(faces[0].getEdge(j));
        faces[i + 1].getEdge(1).setOpposite(faces[j + 1].getEdge(0));
      }
    } else {
      faces.push(Face.createTriangle(v0, v2, v1), Face.createTriangle(v3, v0, v1), Face.createTriangle(v3, v1, v2), Face.createTriangle(v3, v2, v0));
      for (let i = 0; i < 3; i += 1) {
        const j = (i + 1) % 3;
        faces[i + 1].getEdge(2).setOpposite(faces[0].getEdge((3 - i) % 3));
        faces[i + 1].getEdge(0).setOpposite(faces[j + 1].getEdge(1));
      }
    }
    for (let i = 0; i < 4; i += 1) {
      this.faces.push(faces[i]);
    }
    const vertices = this.vertices;
    for (let i = 0; i < vertices.length; i += 1) {
      const vertex = vertices[i];
      if (vertex !== v0 && vertex !== v1 && vertex !== v2 && vertex !== v3) {
        let maxDistance = this.tolerance;
        let maxFace;
        for (let j = 0; j < 4; j += 1) {
          const distance2 = faces[j].distanceToPlane(vertex.point);
          if (distance2 > maxDistance) {
            maxDistance = distance2;
            maxFace = faces[j];
          }
        }
        if (maxFace) {
          this.addVertexToFace(vertex, maxFace);
        }
      }
    }
  }
  reindexFaceAndVertices() {
    const activeFaces = [];
    for (let i = 0; i < this.faces.length; i += 1) {
      const face = this.faces[i];
      if (face.mark === Mark.Visible) {
        activeFaces.push(face);
      }
    }
    this.faces = activeFaces;
  }
  collectFaces(skipTriangulation) {
    const faceIndices = [];
    for (let i = 0; i < this.faces.length; i += 1) {
      if (this.faces[i].mark !== Mark.Visible) {
        throw Error("attempt to include a destroyed face in the hull");
      }
      const indices = this.faces[i].collectIndices();
      if (skipTriangulation) {
        faceIndices.push(indices);
      } else {
        for (let j = 0; j < indices.length - 2; j += 1) {
          faceIndices.push([indices[0], indices[j + 1], indices[j + 2]]);
        }
      }
    }
    return faceIndices;
  }
  /**
   * Finds the next vertex to make faces with the current hull
   *
   * - let `face` be the first face existing in the `claimed` vertex list
   *  - if `face` doesn't exist then return since there're no vertices left
   *  - otherwise for each `vertex` that face sees find the one furthest away
   *  from `face`
   */
  nextVertexToAdd() {
    if (!this.claimed.isEmpty()) {
      let eyeVertex, vertex;
      let maxDistance = 0;
      const eyeFace = this.claimed.first().face;
      for (vertex = eyeFace.outside; vertex && vertex.face === eyeFace; vertex = vertex.next) {
        const distance2 = eyeFace.distanceToPlane(vertex.point);
        if (distance2 > maxDistance) {
          maxDistance = distance2;
          eyeVertex = vertex;
        }
      }
      return eyeVertex;
    }
  }
  /**
   * Computes a chain of half edges in ccw order called the `horizon`, for an
   * edge to be part of the horizon it must join a face that can see
   * `eyePoint` and a face that cannot see `eyePoint`
   *
   * @param {number[]} eyePoint - The coordinates of a point
   * @param {HalfEdge} crossEdge - The edge used to jump to the current `face`
   * @param {Face} face - The current face being tested
   * @param {HalfEdge[]} horizon - The edges that form part of the horizon in
   * ccw order
   */
  computeHorizon(eyePoint, crossEdge, face, horizon) {
    this.deleteFaceVertices(face);
    face.mark = Mark.Deleted;
    let edge;
    if (!crossEdge) {
      edge = crossEdge = face.getEdge(0);
    } else {
      edge = crossEdge.next;
    }
    do {
      const oppositeEdge = edge.opposite;
      const oppositeFace = oppositeEdge.face;
      if (oppositeFace.mark === Mark.Visible) {
        if (oppositeFace.distanceToPlane(eyePoint) > this.tolerance) {
          this.computeHorizon(eyePoint, oppositeEdge, oppositeFace, horizon);
        } else {
          horizon.push(edge);
        }
      }
      edge = edge.next;
    } while (edge !== crossEdge);
  }
  /**
   * Creates a face with the points `eyeVertex.point`, `horizonEdge.tail` and
   * `horizonEdge.tail` in ccw order
   *
   * @param {Vertex} eyeVertex
   * @param {HalfEdge} horizonEdge
   * @return {HalfEdge} The half edge whose vertex is the eyeVertex
   */
  addAdjoiningFace(eyeVertex, horizonEdge) {
    const face = Face.createTriangle(eyeVertex, horizonEdge.tail(), horizonEdge.head());
    this.faces.push(face);
    face.getEdge(-1).setOpposite(horizonEdge.opposite);
    return face.getEdge(0);
  }
  /**
   * Adds horizon.length faces to the hull, each face will be 'linked' with the
   * horizon opposite face and the face on the left/right
   *
   * @param {Vertex} eyeVertex
   * @param {HalfEdge[]} horizon - A chain of half edges in ccw order
   */
  addNewFaces(eyeVertex, horizon) {
    this.newFaces = [];
    let firstSideEdge, previousSideEdge;
    for (let i = 0; i < horizon.length; i += 1) {
      const horizonEdge = horizon[i];
      const sideEdge = this.addAdjoiningFace(eyeVertex, horizonEdge);
      if (!firstSideEdge) {
        firstSideEdge = sideEdge;
      } else {
        sideEdge.next.setOpposite(previousSideEdge);
      }
      this.newFaces.push(sideEdge.face);
      previousSideEdge = sideEdge;
    }
    firstSideEdge.next.setOpposite(previousSideEdge);
  }
  /**
   * Computes the distance from `edge` opposite face's centroid to
   * `edge.face`
   *
   * @param {HalfEdge} edge
   */
  oppositeFaceDistance(edge) {
    return edge.face.distanceToPlane(edge.opposite.face.centroid);
  }
  /**
   * Merges a face with none/any/all its neighbors according to the strategy
   * used
   *
   * if `mergeType` is MERGE_NON_CONVEX_WRT_LARGER_FACE then the merge will be
   * decided based on the face with the larger area, the centroid of the face
   * with the smaller area will be checked against the one with the larger area
   * to see if it's in the merge range [tolerance, -tolerance] i.e.
   *
   *    dot(centroid smaller face, larger face normal) - larger face offset > -tolerance
   *
   * Note that the first check (with +tolerance) was done on `computeHorizon`
   *
   * If the above is not true then the check is done with respect to the smaller
   * face i.e.
   *
   *    dot(centroid larger face, smaller face normal) - smaller face offset > -tolerance
   *
   * If true then it means that two faces are non convex (concave), even if the
   * dot(...) - offset value is > 0 (that's the point of doing the merge in the
   * first place)
   *
   * If two faces are concave then the check must also be done on the other face
   * but this is done in another merge pass, for this to happen the face is
   * marked in a temporal NON_CONVEX state
   *
   * if `mergeType` is MERGE_NON_CONVEX then two faces will be merged only if
   * they pass the following conditions
   *
   *    dot(centroid smaller face, larger face normal) - larger face offset > -tolerance
   *    dot(centroid larger face, smaller face normal) - smaller face offset > -tolerance
   *
   * @param {Face} face
   * @param {MergeType} mergeType
   */
  doAdjacentMerge(face, mergeType) {
    let edge = face.edge;
    let convex = true;
    let it = 0;
    do {
      if (it >= face.nVertices) {
        throw Error("merge recursion limit exceeded");
      }
      const oppositeFace = edge.opposite.face;
      let merge = false;
      if (mergeType === MergeType.NonConvex) {
        if (this.oppositeFaceDistance(edge) > -this.tolerance || this.oppositeFaceDistance(edge.opposite) > -this.tolerance) {
          merge = true;
        }
      } else {
        if (face.area > oppositeFace.area) {
          if (this.oppositeFaceDistance(edge) > -this.tolerance) {
            merge = true;
          } else if (this.oppositeFaceDistance(edge.opposite) > -this.tolerance) {
            convex = false;
          }
        } else {
          if (this.oppositeFaceDistance(edge.opposite) > -this.tolerance) {
            merge = true;
          } else if (this.oppositeFaceDistance(edge) > -this.tolerance) {
            convex = false;
          }
        }
      }
      if (merge) {
        debug3("face merge");
        const discardedFaces = face.mergeAdjacentFaces(edge, []);
        for (let i = 0; i < discardedFaces.length; i += 1) {
          this.deleteFaceVertices(discardedFaces[i], face);
        }
        return true;
      }
      edge = edge.next;
      it += 1;
    } while (edge !== face.edge);
    if (!convex) {
      face.mark = Mark.NonConvex;
    }
    return false;
  }
  /**
   * Adds a vertex to the hull with the following algorithm
   *
   * - Compute the `horizon` which is a chain of half edges, for an edge to
   *   belong to this group it must be the edge connecting a face that can
   *   see `eyeVertex` and a face which cannot see `eyeVertex`
   * - All the faces that can see `eyeVertex` have its visible vertices removed
   *   from the claimed VertexList
   * - A new set of faces is created with each edge of the `horizon` and
   *   `eyeVertex`, each face is connected with the opposite horizon face and
   *   the face on the left/right
   * - The new faces are merged if possible with the opposite horizon face first
   *   and then the faces on the right/left
   * - The vertices removed from all the visible faces are assigned to the new
   *   faces if possible
   *
   * @param {Vertex} eyeVertex
   */
  addVertexToHull(eyeVertex) {
    const horizon = [];
    this.unclaimed.clear();
    this.removeVertexFromFace(eyeVertex, eyeVertex.face);
    this.computeHorizon(eyeVertex.point, null, eyeVertex.face, horizon);
    if (debug3.enabled) {
      debug3("horizon %j", horizon.map(function(edge) {
        return edge.head().index;
      }));
    }
    this.addNewFaces(eyeVertex, horizon);
    debug3("first merge");
    for (let i = 0; i < this.newFaces.length; i += 1) {
      const face = this.newFaces[i];
      if (face.mark === Mark.Visible) {
        while (this.doAdjacentMerge(face, MergeType.NonConvexWrtLargerFace)) {
        }
      }
    }
    debug3("second merge");
    for (let i = 0; i < this.newFaces.length; i += 1) {
      const face = this.newFaces[i];
      if (face.mark === Mark.NonConvex) {
        face.mark = Mark.Visible;
        while (this.doAdjacentMerge(face, MergeType.NonConvexWrtLargerFace)) {
        }
      }
    }
    debug3("reassigning points to newFaces");
    this.resolveUnclaimedPoints(this.newFaces);
  }
  build() {
    let iterations = 0;
    let eyeVertex;
    const [v0, v1, v2, v3] = this.computeTetrahedronExtremes();
    if (this.allPointsBelongToPlane(v0, v1, v2)) {
      this.convexHull2d(v0, v1, v2);
      return this;
    }
    this.createInitialSimplex(v0, v1, v2, v3);
    while (eyeVertex = this.nextVertexToAdd()) {
      iterations += 1;
      debug3(`== iteration ${iterations} ==`);
      debug3("next vertex to add = %d %j", eyeVertex.index, eyeVertex.point);
      this.addVertexToHull(eyeVertex);
      debug3(`== end iteration ${iterations}`);
    }
    this.reindexFaceAndVertices();
    return this;
  }
};

// node_modules/quickhull3d/dist/index.js
function runner(points, options = {}) {
  const instance = new QuickHull(points);
  instance.build();
  return instance.collectFaces(options.skipTriangulation);
}
function isPointInsideHull(point, points, faces) {
  for (let i = 0; i < faces.length; i++) {
    const face = faces[i];
    const a = points[face[0]];
    const b = points[face[1]];
    const c = points[face[2]];
    const planeNormal = (0, import_get_plane_normal2.default)(new Float32Array(3), a, b, c);
    const pointAbsA = [point[0] - a[0], point[1] - a[1], point[2] - a[2]];
    const dotProduct = planeNormal[0] * pointAbsA[0] + planeNormal[1] * pointAbsA[1] + planeNormal[2] * pointAbsA[2];
    if (dotProduct > 0) {
      return false;
    }
  }
  return true;
}
export {
  QuickHull,
  QuickHullOptions,
  runner as default,
  isPointInsideHull
};
