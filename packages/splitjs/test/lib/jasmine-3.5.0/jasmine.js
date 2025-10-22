/*
Copyright (c) 2008-2019 Pivotal Labs

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
// eslint-disable-next-line no-unused-vars
var getJasmineRequireObj = (function(jasmineGlobal) {
  var jasmineRequire;

  if (
    typeof module !== 'undefined' &&
    module.exports &&
    typeof exports !== 'undefined'
  ) {
    if (typeof global !== 'undefined') {
      jasmineGlobal = global;
    } else {
      jasmineGlobal = {};
    }
    jasmineRequire = exports;
  } else {
    if (
      typeof window !== 'undefined' &&
      typeof window.toString === 'function' &&
      window.toString() === '[object GjsGlobal]'
    ) {
      jasmineGlobal = window;
    }
    jasmineRequire = jasmineGlobal.jasmineRequire = {};
  }

  function getJasmineRequire() {
    return jasmineRequire;
  }

  getJasmineRequire().core = function(jRequire) {
    var j$ = {};

    jRequire.base(j$, jasmineGlobal);
    j$.util = jRequire.util(j$);
    j$.errors = jRequire.errors();
    j$.formatErrorMsg = jRequire.formatErrorMsg();
    j$.Any = jRequire.Any(j$);
    j$.Anything = jRequire.Anything(j$);
    j$.CallTracker = jRequire.CallTracker(j$);
    j$.MockDate = jRequire.MockDate();
    j$.getClearStack = jRequire.clearStack(j$);
    j$.Clock = jRequire.Clock();
    j$.DelayedFunctionScheduler = jRequire.DelayedFunctionScheduler(j$);
    j$.Env = jRequire.Env(j$);
    j$.StackTrace = jRequire.StackTrace(j$);
    j$.ExceptionFormatter = jRequire.ExceptionFormatter(j$);
    j$.ExpectationFilterChain = jRequire.ExpectationFilterChain();
    j$.Expector = jRequire.Expector(j$);
    j$.Expectation = jRequire.Expectation(j$);
    j$.buildExpectationResult = jRequire.buildExpectationResult();
    j$.noopTimer = jRequire.noopTimer();
    j$.JsApiReporter = jRequire.JsApiReporter(j$);
    j$.matchersUtil = jRequire.matchersUtil(j$);
    j$.ObjectContaining = jRequire.ObjectContaining(j$);
    j$.ArrayContaining = jRequire.ArrayContaining(j$);
    j$.ArrayWithExactContents = jRequire.ArrayWithExactContents(j$);
    j$.MapContaining = jRequire.MapContaining(j$);
    j$.SetContaining = jRequire.SetContaining(j$);
    j$.pp = jRequire.pp(j$);
    j$.QueueRunner = jRequire.QueueRunner(j$);
    j$.ReportDispatcher = jRequire.ReportDispatcher(j$);
    j$.Spec = jRequire.Spec(j$);
    j$.Spy = jRequire.Spy(j$);
    j$.SpyFactory = jRequire.SpyFactory(j$);
    j$.SpyRegistry = jRequire.SpyRegistry(j$);
    j$.SpyStrategy = jRequire.SpyStrategy(j$);
    j$.StringMatching = jRequire.StringMatching(j$);
    j$.UserContext = jRequire.UserContext(j$);
    j$.Suite = jRequire.Suite(j$);
    j$.Timer = jRequire.Timer();
    j$.TreeProcessor = jRequire.TreeProcessor();
    j$.version = jRequire.version();
    j$.Order = jRequire.Order();
    j$.DiffBuilder = jRequire.DiffBuilder(j$);
    j$.NullDiffBuilder = jRequire.NullDiffBuilder(j$);
    j$.ObjectPath = jRequire.ObjectPath(j$);
    j$.GlobalErrors = jRequire.GlobalErrors(j$);

    j$.Truthy = jRequire.Truthy(j$);
    j$.Falsy = jRequire.Falsy(j$);
    j$.Empty = jRequire.Empty(j$);
    j$.NotEmpty = jRequire.NotEmpty(j$);

    j$.matchers = jRequire.requireMatchers(jRequire, j$);
    j$.asyncMatchers = jRequire.requireAsyncMatchers(jRequire, j$);

    return j$;
  };

  return getJasmineRequire;
})(this);

getJasmineRequireObj().requireMatchers = function(jRequire, j$) {
  var availableMatchers = [
      'nothing',
      'toBe',
      'toBeCloseTo',
      'toBeDefined',
      'toBeInstanceOf',
      'toBeFalse',
      'toBeFalsy',
      'toBeGreaterThan',
      'toBeGreaterThanOrEqual',
      'toBeLessThan',
      'toBeLessThanOrEqual',
      'toBeNaN',
      'toBeNegativeInfinity',
      'toBeNull',
      'toBePositiveInfinity',
      'toBeTrue',
      'toBeTruthy',
      'toBeUndefined',
      'toContain',
      'toEqual',
      'toHaveBeenCalled',
      'toHaveBeenCalledBefore',
      'toHaveBeenCalledTimes',
      'toHaveBeenCalledWith',
      'toHaveClass',
      'toMatch',
      'toThrow',
      'toThrowError',
      'toThrowMatching'
    ],
    matchers = {};

  for (var i = 0; i < availableMatchers.length; i++) {
    var name = availableMatchers[i];
    matchers[name] = jRequire[name](j$);
  }

  return matchers;
};

getJasmineRequireObj().base = function(j$, jasmineGlobal) {
  j$.unimplementedMethod_ = function() {
    throw new Error('unimplemented method');
  };

  /**
   * Maximum object depth the pretty printer will print to.
   * Set this to a lower value to speed up pretty printing if you have large objects.
   * @name jasmine.MAX_PRETTY_PRINT_DEPTH
   * @since 1.3.0
   */
  j$.MAX_PRETTY_PRINT_DEPTH = 8;
  /**
   * Maximum number of array elements to display when pretty printing objects.
   * This will also limit the number of keys and values displayed for an object.
   * Elements past this number will be ellipised.
   * @name jasmine.MAX_PRETTY_PRINT_ARRAY_LENGTH
   * @since 2.7.0
   */
  j$.MAX_PRETTY_PRINT_ARRAY_LENGTH = 50;
  /**
   * Maximum number of characters to display when pretty printing objects.
   * Characters past this number will be ellipised.
   * @name jasmine.MAX_PRETTY_PRINT_CHARS
   * @since 2.9.0
   */
  j$.MAX_PRETTY_PRINT_CHARS = 1000;
  /**
   * Default number of milliseconds Jasmine will wait for an asynchronous spec to complete.
   * @name jasmine.DEFAULT_TIMEOUT_INTERVAL
   * @since 1.3.0
   */
  j$.DEFAULT_TIMEOUT_INTERVAL = 5000;

  j$.getGlobal = function() {
    return jasmineGlobal;
  };

  /**
   * Get the currently booted Jasmine Environment.
   *
   * @name jasmine.getEnv
   * @since 1.3.0
   * @function
   * @return {Env}
   */
  j$.getEnv = function(options) {
    var env = (j$.currentEnv_ = j$.currentEnv_ || new j$.Env(options));
    //jasmine. singletons in here (setTimeout blah blah).
    return env;
  };

  j$.isArray_ = function(value) {
    return j$.isA_('Array', value);
  };

  j$.isObject_ = function(value) {
    return (
      !j$.util.isUndefined(value) && value !== null && j$.isA_('Object', value)
    );
  };

  j$.isString_ = function(value) {
    return j$.isA_('String', value);
  };

  j$.isNumber_ = function(value) {
    return j$.isA_('Number', value);
  };

  j$.isFunction_ = function(value) {
    return j$.isA_('Function', value);
  };

  j$.isAsyncFunction_ = function(value) {
    return j$.isA_('AsyncFunction', value);
  };

  j$.isTypedArray_ = function(value) {
    return (
      j$.isA_('Float32Array', value) ||
      j$.isA_('Float64Array', value) ||
      j$.isA_('Int16Array', value) ||
      j$.isA_('Int32Array', value) ||
      j$.isA_('Int8Array', value) ||
      j$.isA_('Uint16Array', value) ||
      j$.isA_('Uint32Array', value) ||
      j$.isA_('Uint8Array', value) ||
      j$.isA_('Uint8ClampedArray', value)
    );
  };

  j$.isA_ = function(typeName, value) {
    return j$.getType_(value) === '[object ' + typeName + ']';
  };

  j$.isError_ = function(value) {
    if (value instanceof Error) {
      return true;
    }
    if (value && value.constructor && value.constructor.constructor) {
      var valueGlobal = value.constructor.constructor('return this');
      if (j$.isFunction_(valueGlobal)) {
        valueGlobal = valueGlobal();
      }

      if (valueGlobal.Error && value instanceof valueGlobal.Error) {
        return true;
      }
    }
    return false;
  };

  j$.getType_ = function(value) {
    return Object.prototype.toString.apply(value);
  };

  j$.isDomNode = function(obj) {
    // Node is a function, because constructors
    return typeof jasmineGlobal.Node !== 'undefined'
      ? obj instanceof jasmineGlobal.Node
      : obj !== null &&
          typeof obj === 'object' &&
          typeof obj.nodeType === 'number' &&
          typeof obj.nodeName === 'string';
    // return obj.nodeType > 0;
  };

  j$.isMap = function(obj) {
    return (
      obj !== null &&
      typeof obj !== 'undefined' &&
      typeof jasmineGlobal.Map !== 'undefined' &&
      obj.constructor === jasmineGlobal.Map
    );
  };

  j$.isSet = function(obj) {
    return (
      obj !== null &&
      typeof obj !== 'undefined' &&
      typeof jasmineGlobal.Set !== 'undefined' &&
      obj.constructor === jasmineGlobal.Set
    );
  };

  j$.isPromise = function(obj) {
    return (
      typeof jasmineGlobal.Promise !== 'undefined' &&
      !!obj &&
      obj.constructor === jasmineGlobal.Promise
    );
  };

  j$.isPromiseLike = function(obj) {
    return !!obj && j$.isFunction_(obj.then);
  };

  j$.fnNameFor = function(func) {
    if (func.name) {
      return func.name;
    }

    var matches =
      func.toString().match(/^\s*function\s*(\w+)\s*\(/) ||
      func.toString().match(/^\s*\[object\s*(\w+)Constructor\]/);

    return matches ? matches[1] : '<anonymous>';
  };

  /**
   * Get a matcher, usable in any {@link matchers|matcher} that uses Jasmine's equality (e.g. {@link matchers#toEqual|toEqual}, {@link matchers#toContain|toContain}, or {@link matchers#toHaveBeenCalledWith|toHaveBeenCalledWith}),
   * that will succeed if the actual value being compared is an instance of the specified class/constructor.
   * @name jasmine.any
   * @since 1.3.0
   * @function
   * @param {Constructor} clazz - The constructor to check against.
   */
  j$.any = function(clazz) {
    return new j$.Any(clazz);
  };

  /**
   * Get a matcher, usable in any {@link matchers|matcher} that uses Jasmine's equality (e.g. {@link matchers#toEqual|toEqual}, {@link matchers#toContain|toContain}, or {@link matchers#toHaveBeenCalledWith|toHaveBeenCalledWith}),
   * that will succeed if the actual value being compared is not `null` and not `undefined`.
   * @name jasmine.anything
   * @since 2.2.0
   * @function
   */
  j$.anything = function() {
    return new j$.Anything();
  };

  /**
   * Get a matcher, usable in any {@link matchers|matcher} that uses Jasmine's equality (e.g. {@link matchers#toEqual|toEqual}, {@link matchers#toContain|toContain}, or {@link matchers#toHaveBeenCalledWith|toHaveBeenCalledWith}),
   * that will succeed if the actual value being compared is `true` or anything truthy.
   * @name jasmine.truthy
   * @since 3.1.0
   * @function
   */
  j$.truthy = function() {
    return new j$.Truthy();
  };

  /**
   * Get a matcher, usable in any {@link matchers|matcher} that uses Jasmine's equality (e.g. {@link matchers#toEqual|toEqual}, {@link matchers#toContain|toContain}, or {@link matchers#toHaveBeenCalledWith|toHaveBeenCalledWith}),
   * that will succeed if the actual value being compared is  `null`, `undefined`, `0`, `false` or anything falsey.
   * @name jasmine.falsy
   * @since 3.1.0
   * @function
   */
  j$.falsy = function() {
    return new j$.Falsy();
  };

  /**
   * Get a matcher, usable in any {@link matchers|matcher} that uses Jasmine's equality (e.g. {@link matchers#toEqual|toEqual}, {@link matchers#toContain|toContain}, or {@link matchers#toHaveBeenCalledWith|toHaveBeenCalledWith}),
   * that will succeed if the actual value being compared is empty.
   * @name jasmine.empty
   * @since 3.1.0
   * @function
   */
  j$.empty = function() {
    return new j$.Empty();
  };

  /**
   * Get a matcher, usable in any {@link matchers|matcher} that uses Jasmine's equality (e.g. {@link matchers#toEqual|toEqual}, {@link matchers#toContain|toContain}, or {@link matchers#toHaveBeenCalledWith|toHaveBeenCalledWith}),
   * that will succeed if the actual value being compared is not empty.
   * @name jasmine.notEmpty
   * @since 3.1.0
   * @function
   */
  j$.notEmpty = function() {
    return new j$.NotEmpty();
  };

  /**
   * Get a matcher, usable in any {@link matchers|matcher} that uses Jasmine's equality (e.g. {@link matchers#toEqual|toEqual}, {@link matchers#toContain|toContain}, or {@link matchers#toHaveBeenCalledWith|toHaveBeenCalledWith}),
   * that will succeed if the actual value being compared contains at least the keys and values.
   * @name jasmine.objectContaining
   * @since 1.3.0
   * @function
   * @param {Object} sample - The subset of properties that _must_ be in the actual.
   */
  j$.objectContaining = function(sample) {
    return new j$.ObjectContaining(sample);
  };

  /**
   * Get a matcher, usable in any {@link matchers|matcher} that uses Jasmine's equality (e.g. {@link matchers#toEqual|toEqual}, {@link matchers#toContain|toContain}, or {@link matchers#toHaveBeenCalledWith|toHaveBeenCalledWith}),
   * that will succeed if the actual value is a `String` that matches the `RegExp` or `String`.
   * @name jasmine.stringMatching
   * @since 2.2.0
   * @function
   * @param {RegExp|String} expected
   */
  j$.stringMatching = function(expected) {
    return new j$.StringMatching(expected);
  };

  /**
   * Get a matcher, usable in any {@link matchers|matcher} that uses Jasmine's equality (e.g. {@link matchers#toEqual|toEqual}, {@link matchers#toContain|toContain}, or {@link matchers#toHaveBeenCalledWith|toHaveBeenCalledWith}),
   * that will succeed if the actual value is an `Array` that contains at least the elements in the sample.
   * @name jasmine.arrayContaining
   * @since 2.2.0
   * @function
   * @param {Array} sample
   */
  j$.arrayContaining = function(sample) {
    return new j$.ArrayContaining(sample);
  };

  /**
   * Get a matcher, usable in any {@link matchers|matcher} that uses Jasmine's equality (e.g. {@link matchers#toEqual|toEqual}, {@link matchers#toContain|toContain}, or {@link matchers#toHaveBeenCalledWith|toHaveBeenCalledWith}),
   * that will succeed if the actual value is an `Array` that contains all of the elements in the sample in any order.
   * @name jasmine.arrayWithExactContents
   * @since 2.8.0
   * @function
   * @param {Array} sample
   */
  j$.arrayWithExactContents = function(sample) {
    return new j$.ArrayWithExactContents(sample);
  };

  /**
   * Get a matcher, usable in any {@link matchers|matcher} that uses Jasmine's equality (e.g. {@link matchers#toEqual|toEqual}, {@link matchers#toContain|toContain}, or {@link matchers#toHaveBeenCalledWith|toHaveBeenCalledWith}),
   * that will succeed if every key/value pair in the sample passes the deep equality comparison
   * with at least one key/value pair in the actual value being compared
   * @name jasmine.mapContaining
   * @since 3.5.0
   * @function
   * @param {Map} sample - The subset of items that _must_ be in the actual.
   */
  j$.mapContaining = function(sample) {
    return new j$.MapContaining(sample);
  };

  /**
   * Get a matcher, usable in any {@link matchers|matcher} that uses Jasmine's equality (e.g. {@link matchers#toEqual|toEqual}, {@link matchers#toContain|toContain}, or {@link matchers#toHaveBeenCalledWith|toHaveBeenCalledWith}),
   * that will succeed if every item in the sample passes the deep equality comparison
   * with at least one item in the actual value being compared
   * @name jasmine.setContaining
   * @since 3.5.0
   * @function
   * @param {Set} sample - The subset of items that _must_ be in the actual.
   */
  j$.setContaining = function(sample) {
    return new j$.SetContaining(sample);
  };

  j$.isSpy = function(putativeSpy) {
    if (!putativeSpy) {
      return false;
    }
    return (
      putativeSpy.and instanceof j$.SpyStrategy &&
      putativeSpy.calls instanceof j$.CallTracker
    );
  };
};

getJasmineRequireObj().util = function(j$) {
  var util = {};

  util.inherit = function(childClass, parentClass) {
    var Subclass = function() {};
    Subclass.prototype = parentClass.prototype;
    childClass.prototype = new Subclass();
  };

  util.htmlEscape = function(str) {
    if (!str) {
      return str;
    }
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  };

  util.argsToArray = function(args) {
    var arrayOfArgs = [];
    for (var i = 0; i < args.length; i++) {
      arrayOfArgs.push(args[i]);
    }
    return arrayOfArgs;
  };

  util.isUndefined = function(obj) {
    return obj === void 0;
  };

  util.arrayContains = function(array, search) {
    var i = array.length;
    while (i--) {
      if (array[i] === search) {
        return true;
      }
    }
    return false;
  };

  util.clone = function(obj) {
    if (Object.prototype.toString.apply(obj) === '[object Array]') {
      return obj.slice();
    }

    var cloned = {};
    for (var prop in obj) {
      if (obj.hasOwnProperty(prop)) {
        cloned[prop] = obj[prop];
      }
    }

    return cloned;
  };

  util.cloneArgs = function(args) {
    var clonedArgs = [];
    var argsAsArray = j$.util.argsToArray(args);
    for (var i = 0; i < argsAsArray.length; i++) {
      var str = Object.prototype.toString.apply(argsAsArray[i]),
        primitives = /^\[object (Boolean|String|RegExp|Number)/;

      // All falsey values are either primitives, `null`, or `undefined.
      if (!argsAsArray[i] || str.match(primitives)) {
        clonedArgs.push(argsAsArray[i]);
      } else {
        clonedArgs.push(j$.util.clone(argsAsArray[i]));
      }
    }
    return clonedArgs;
  };

  util.getPropertyDescriptor = function(obj, methodName) {
    var descriptor,
      proto = obj;

    do {
      descriptor = Object.getOwnPropertyDescriptor(proto, methodName);
      proto = Object.getPrototypeOf(proto);
    } while (!descriptor && proto);

    return descriptor;
  };

  util.objectDifference = function(obj, toRemove) {
    var diff = {};

    for (var key in obj) {
      if (util.has(obj, key) && !util.has(toRemove, key)) {
        diff[key] = obj[key];
      }
    }

    return diff;
  };

  util.has = function(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  };

  util.errorWithStack = function errorWithStack() {
    // Don't throw and catch if we don't have to, because it makes it harder
    // for users to debug their code with exception breakpoints.
    var error = new Error();

    if (error.stack) {
      return error;
    }

    // But some browsers (e.g. Phantom) only provide a stack trace if we throw.
    try {
      throw new Error();
    } catch (e) {
      return e;
    }
  };

  function callerFile() {
    var trace = new j$.StackTrace(util.errorWithStack());
    return trace.frames[2].file;
  }

  util.jasmineFile = (function() {
    var result;

    return function() {
      if (!result) {
        result = callerFile();
      }

      return result;
    };
  })();

  function StopIteration() {}
  StopIteration.prototype = Object.create(Error.prototype);
  StopIteration.prototype.constructor = StopIteration;

  // useful for maps and sets since `forEach` is the only IE11-compatible way to iterate them
  util.forEachBreakable = function(iterable, iteratee) {
    function breakLoop() {
      throw new StopIteration();
    }

    try {
      iterable.forEach(function(value, key) {
        iteratee(breakLoop, value, key, iterable);
      });
    } catch (error) {
      if (!(error instanceof StopIteration)) throw error;
    }
  };

  return util;
};

getJasmineRequireObj().Spec = function(j$) {
  function Spec(attrs) {
    this.expectationFactory = attrs.expectationFactory;
    this.asyncExpectationFactory = attrs.asyncExpectationFactory;
    this.resultCallback = attrs.resultCallback || function() {};
    this.id = attrs.id;
    this.description = attrs.description || '';
    this.queueableFn = attrs.queueableFn;
    this.beforeAndAfterFns =
      attrs.beforeAndAfterFns ||
      function() {
        return { befores: [], afters: [] };
      };
    this.userContext =
      attrs.userContext ||
      function() {
        return {};
      };
    this.onStart = attrs.onStart || function() {};
    this.getSpecName =
      attrs.getSpecName ||
      function() {
        return '';
      };
    this.expectationResultFactory =
      attrs.expectationResultFactory || function() {};
    this.queueRunnerFactory = attrs.queueRunnerFactory || function() {};
    this.catchingExceptions =
      attrs.catchingExceptions ||
      function() {
        return true;
      };
    this.throwOnExpectationFailure = !!attrs.throwOnExpectationFailure;
    this.timer = attrs.timer || j$.noopTimer;

    if (!this.queueableFn.fn) {
      this.pend();
    }

    /**
     * @typedef SpecResult
     * @property {Int} id - The unique id of this spec.
     * @property {String} description - The description passed to the {@link it} that created this spec.
     * @property {String} fullName - The full description including all ancestors of this spec.
     * @property {Expectation[]} failedExpectations - The list of expectations that failed during execution of this spec.
     * @property {Expectation[]} passedExpectations - The list of expectations that passed during execution of this spec.
     * @property {Expectation[]} deprecationWarnings - The list of deprecation warnings that occurred during execution this spec.
     * @property {String} pendingReason - If the spec is {@link pending}, this will be the reason.
     * @property {String} status - Once the spec has completed, this string represents the pass/fail status of this spec.
     * @property {number} duration - The time in ms used by the spec execution, including any before/afterEach.
     */
    this.result = {
      id: this.id,
      description: this.description,
      fullName: this.getFullName(),
      failedExpectations: [],
      passedExpectations: [],
      deprecationWarnings: [],
      pendingReason: '',
      duration: null
    };
  }

  Spec.prototype.addExpectationResult = function(passed, data, isError) {
    var expectationResult = this.expectationResultFactory(data);
    if (passed) {
      this.result.passedExpectations.push(expectationResult);
    } else {
      this.result.failedExpectations.push(expectationResult);

      if (this.throwOnExpectationFailure && !isError) {
        throw new j$.errors.ExpectationFailed();
      }
    }
  };

  Spec.prototype.expect = function(actual) {
    return this.expectationFactory(actual, this);
  };

  Spec.prototype.expectAsync = function(actual) {
    return this.asyncExpectationFactory(actual, this);
  };

  Spec.prototype.execute = function(onComplete, excluded, failSpecWithNoExp) {
    var self = this;

    var onStart = {
      fn: function(done) {
        self.timer.start();
        self.onStart(self, done);
      }
    };

    var complete = {
      fn: function(done) {
        self.queueableFn.fn = null;
        self.result.status = self.status(excluded, failSpecWithNoExp);
        self.resultCallback(self.result, done);
      }
    };

    var fns = this.beforeAndAfterFns();
    var regularFns = fns.befores.concat(this.queueableFn);

    var runnerConfig = {
      isLeaf: true,
      queueableFns: regularFns,
      cleanupFns: fns.afters,
      onException: function() {
        self.onException.apply(self, arguments);
      },
      onComplete: function() {
        self.result.duration = self.timer.elapsed();
        onComplete(
          self.result.status === 'failed' &&
            new j$.StopExecutionError('spec failed')
        );
      },
      userContext: this.userContext()
    };

    if (this.markedPending || excluded === true) {
      runnerConfig.queueableFns = [];
      runnerConfig.cleanupFns = [];
    }

    runnerConfig.queueableFns.unshift(onStart);
    runnerConfig.cleanupFns.push(complete);

    this.queueRunnerFactory(runnerConfig);
  };

  Spec.prototype.onException = function onException(e) {
    if (Spec.isPendingSpecException(e)) {
      this.pend(extractCustomPendingMessage(e));
      return;
    }

    if (e instanceof j$.errors.ExpectationFailed) {
      return;
    }

    this.addExpectationResult(
      false,
      {
        matcherName: '',
        passed: false,
        expected: '',
        actual: '',
        error: e
      },
      true
    );
  };

  Spec.prototype.pend = function(message) {
    this.markedPending = true;
    if (message) {
      this.result.pendingReason = message;
    }
  };

  Spec.prototype.getResult = function() {
    this.result.status = this.status();
    return this.result;
  };

  Spec.prototype.status = function(excluded, failSpecWithNoExpectations) {
    if (excluded === true) {
      return 'excluded';
    }

    if (this.markedPending) {
      return 'pending';
    }

    if (
      this.result.failedExpectations.length > 0 ||
      (failSpecWithNoExpectations &&
        this.result.failedExpectations.length +
          this.result.passedExpectations.length ===
          0)
    ) {
      return 'failed';
    }

    return 'passed';
  };

  Spec.prototype.getFullName = function() {
    return this.getSpecName(this);
  };

  Spec.prototype.addDeprecationWarning = function(deprecation) {
    if (typeof deprecation === 'string') {
      deprecation = { message: deprecation };
    }
    this.result.deprecationWarnings.push(
      this.expectationResultFactory(deprecation)
    );
  };

  var extractCustomPendingMessage = function(e) {
    var fullMessage = e.toString(),
      boilerplateStart = fullMessage.indexOf(Spec.pendingSpecExceptionMessage),
      boilerplateEnd =
        boilerplateStart + Spec.pendingSpecExceptionMessage.length;

    return fullMessage.substr(boilerplateEnd);
  };

  Spec.pendingSpecExceptionMessage = '=> marked Pending';

  Spec.isPendingSpecException = function(e) {
    return !!(
      e &&
      e.toString &&
      e.toString().indexOf(Spec.pendingSpecExceptionMessage) !== -1
    );
  };

  return Spec;
};

if (typeof window == void 0 && typeof exports == 'object') {
  /* globals exports */
  exports.Spec = jasmineRequire.Spec;
}

/*jshint bitwise: false*/

getJasmineRequireObj().Order = function() {
  function Order(options) {
    this.random = 'random' in options ? options.random : true;
    var seed = (this.seed = options.seed || generateSeed());
    this.sort = this.random ? randomOrder : naturalOrder;

    function naturalOrder(items) {
      return items;
    }

    function randomOrder(items) {
      var copy = items.slice();
      copy.sort(function(a, b) {
        return jenkinsHash(seed + a.id) - jenkinsHash(seed + b.id);
      });
      return copy;
    }

    function generateSeed() {
      return String(Math.random()).slice(-5);
    }

    // Bob Jenkins One-at-a-Time Hash algorithm is a non-cryptographic hash function
    // used to get a different output when the key changes slightly.
    // We use your return to sort the children randomly in a consistent way when
    // used in conjunction with a seed

    function jenkinsHash(key) {
      var hash, i;
      for (hash = i = 0; i < key.length; ++i) {
        hash += key.charCodeAt(i);
        hash += hash << 10;
        hash ^= hash >> 6;
      }
      hash += hash << 3;
      hash ^= hash >> 11;
      hash += hash << 15;
      return hash;
    }
  }

  return Order;
};

getJasmineRequireObj().Env = function(j$) {
  /**
   * _Note:_ Do not construct this directly, Jasmine will make one during booting.
   * @name Env
   * @since 2.0.0
   * @classdesc The Jasmine environment
   * @constructor
   */
  function Env(options) {
    options = options || {};

    var self = this;
    var global = options.global || j$.getGlobal();
    var customPromise;

    var totalSpecsDefined = 0;

    var realSetTimeout = global.setTimeout;
    var realClearTimeout = global.clearTimeout;
    var clearStack = j$.getClearStack(global);
    this.clock = new j$.Clock(
      global,
      function() {
        return new j$.DelayedFunctionScheduler();
      },
      new j$.MockDate(global)
    );

    var runnableResources = {};

    var currentSpec = null;
    var currentlyExecutingSuites = [];
    var currentDeclarationSuite = null;
    var hasFailures = false;

    /**
     * This represents the available options to configure Jasmine.
     * Options that are not provided will use their default values
     * @interface Configuration
     * @since 3.3.0
     */
    var config = {
      /**
       * Whether to randomize spec execution order
       * @name Configuration#random
       * @since 3.3.0
       * @type Boolean
       * @default true
       */
      random: true,
      /**
       * Seed to use as the basis of randomization.
       * Null causes the seed to be determined randomly at the start of execution.
       * @name Configuration#seed
       * @since 3.3.0
       * @type function
       * @default null
       */
      seed: null,
      /**
       * Whether to stop execution of the suite after the first spec failure
       * @name Configuration#failFast
       * @since 3.3.0
       * @type Boolean
       * @default false
       */
      failFast: false,
      /**
       * Whether to fail the spec if it ran no expectations. By default
       * a spec that ran no expectations is reported as passed. Setting this
       * to true will report such spec as a failure.
       * @name Configuration#failSpecWithNoExpectations
       * @since 3.5.0
       * @type Boolean
       * @default false
       */
      failSpecWithNoExpectations: false,
      /**
       * Whether to cause specs to only have one expectation failure.
       * @name Configuration#oneFailurePerSpec
       * @since 3.3.0
       * @type Boolean
       * @default false
       */
      oneFailurePerSpec: false,
      /**
       * Function to use to filter specs
       * @name Configuration#specFilter
       * @since 3.3.0
       * @type function
       * @default true
       */
      specFilter: function() {
        return true;
      },
      /**
       * Whether or not reporters should hide disabled specs from their output.
       * Currently only supported by Jasmine's HTMLReporter
       * @name Configuration#hideDisabled
       * @since 3.3.0
       * @type Boolean
       * @default false
       */
      hideDisabled: false,
      /**
       * Set to provide a custom promise library that Jasmine will use if it needs
       * to create a promise. If not set, it will default to whatever global Promise
       * library is available (if any).
       * @name Configuration#Promise
       * @since 3.5.0
       * @type function
       * @default undefined
       */
      Promise: undefined
    };

    var currentSuite = function() {
      return currentlyExecutingSuites[currentlyExecutingSuites.length - 1];
    };

    var currentRunnable = function() {
      return currentSpec || currentSuite();
    };

    var globalErrors = null;

    var installGlobalErrors = function() {
      if (globalErrors) {
        return;
      }

      globalErrors = new j$.GlobalErrors();
      globalErrors.install();
    };

    if (!options.suppressLoadErrors) {
      installGlobalErrors();
      globalErrors.pushListener(function(
        message,
        filename,
        lineno,
        colNo,
        err
      ) {
        topSuite.result.failedExpectations.push({
          passed: false,
          globalErrorType: 'load',
          message: message,
          stack: err && err.stack,
          filename: filename,
          lineno: lineno
        });
      });
    }

    /**
     * Configure your jasmine environment
     * @name Env#configure
     * @since 3.3.0
     * @argument {Configuration} configuration
     * @function
     */
    this.configure = function(configuration) {
      if (configuration.specFilter) {
        config.specFilter = configuration.specFilter;
      }

      if (configuration.hasOwnProperty('random')) {
        config.random = !!configuration.random;
      }

      if (configuration.hasOwnProperty('seed')) {
        config.seed = configuration.seed;
      }

      if (configuration.hasOwnProperty('failFast')) {
        config.failFast = configuration.failFast;
      }

      if (configuration.hasOwnProperty('failSpecWithNoExpectations')) {
        config.failSpecWithNoExpectations =
          configuration.failSpecWithNoExpectations;
      }

      if (configuration.hasOwnProperty('oneFailurePerSpec')) {
        config.oneFailurePerSpec = configuration.oneFailurePerSpec;
      }

      if (configuration.hasOwnProperty('hideDisabled')) {
        config.hideDisabled = configuration.hideDisabled;
      }

      // Don't use hasOwnProperty to check for Promise existence because Promise
      // can be initialized to undefined, either explicitly or by using the
      // object returned from Env#configuration. In particular, Karma does this.
      if (configuration.Promise) {
        if (
          typeof configuration.Promise.resolve === 'function' &&
          typeof configuration.Promise.reject === 'function'
        ) {
          customPromise = configuration.Promise;
        } else {
          throw new Error(
            'Custom promise library missing `resolve`/`reject` functions'
          );
        }
      }
    };

    /**
     * Get the current configuration for your jasmine environment
     * @name Env#configuration
     * @since 3.3.0
     * @function
     * @returns {Configuration}
     */
    this.configuration = function() {
      var result = {};
      for (var property in config) {
        result[property] = config[property];
      }
      return result;
    };

    Object.defineProperty(this, 'specFilter', {
      get: function() {
        self.deprecated(
          'Getting specFilter directly from Env is deprecated and will be removed in a future version of Jasmine, please check the specFilter option from `configuration`'
        );
        return config.specFilter;
      },
      set: function(val) {
        self.deprecated(
          'Setting specFilter directly on Env is deprecated and will be removed in a future version of Jasmine, please use the specFilter option in `configure`'
        );
        config.specFilter = val;
      }
    });

    this.setDefaultSpyStrategy = function(defaultStrategyFn) {
      if (!currentRunnable()) {
        throw new Error(
          'Default spy strategy must be set in a before function or a spec'
        );
      }
      runnableResources[
        currentRunnable().id
      ].defaultStrategyFn = defaultStrategyFn;
    };

    this.addSpyStrategy = function(name, fn) {
      if (!currentRunnable()) {
        throw new Error(
          'Custom spy strategies must be added in a before function or a spec'
        );
      }
      runnableResources[currentRunnable().id].customSpyStrategies[name] = fn;
    };

    this.addCustomEqualityTester = function(tester) {
      if (!currentRunnable()) {
        throw new Error(
          'Custom Equalities must be added in a before function or a spec'
        );
      }
      runnableResources[currentRunnable().id].customEqualityTesters.push(
        tester
      );
    };

    this.addMatchers = function(matchersToAdd) {
      if (!currentRunnable()) {
        throw new Error(
          'Matchers must be added in a before function or a spec'
        );
      }
      var customMatchers =
        runnableResources[currentRunnable().id].customMatchers;
      for (var matcherName in matchersToAdd) {
        customMatchers[matcherName] = matchersToAdd[matcherName];
      }
    };

    this.addAsyncMatchers = function(matchersToAdd) {
      if (!currentRunnable()) {
        throw new Error(
          'Async Matchers must be added in a before function or a spec'
        );
      }
      var customAsyncMatchers =
        runnableResources[currentRunnable().id].customAsyncMatchers;
      for (var matcherName in matchersToAdd) {
        customAsyncMatchers[matcherName] = matchersToAdd[matcherName];
      }
    };

    j$.Expectation.addCoreMatchers(j$.matchers);
    j$.Expectation.addAsyncCoreMatchers(j$.asyncMatchers);

    var nextSpecId = 0;
    var getNextSpecId = function() {
      return 'spec' + nextSpecId++;
    };

    var nextSuiteId = 0;
    var getNextSuiteId = function() {
      return 'suite' + nextSuiteId++;
    };

    var expectationFactory = function(actual, spec) {
      return j$.Expectation.factory({
        util: j$.matchersUtil,
        customEqualityTesters: runnableResources[spec.id].customEqualityTesters,
        customMatchers: runnableResources[spec.id].customMatchers,
        actual: actual,
        addExpectationResult: addExpectationResult
      });

      function addExpectationResult(passed, result) {
        return spec.addExpectationResult(passed, result);
      }
    };

    var asyncExpectationFactory = function(actual, spec) {
      return j$.Expectation.asyncFactory({
        util: j$.matchersUtil,
        customEqualityTesters: runnableResources[spec.id].customEqualityTesters,
        customAsyncMatchers: runnableResources[spec.id].customAsyncMatchers,
        actual: actual,
        addExpectationResult: addExpectationResult
      });

      function addExpectationResult(passed, result) {
        return spec.addExpectationResult(passed, result);
      }
    };

    var defaultResourcesForRunnable = function(id, parentRunnableId) {
      var resources = {
        spies: [],
        customEqualityTesters: [],
        customMatchers: {},
        customAsyncMatchers: {},
        customSpyStrategies: {},
        defaultStrategyFn: undefined
      };

      if (runnableResources[parentRunnableId]) {
        resources.customEqualityTesters = j$.util.clone(
          runnableResources[parentRunnableId].customEqualityTesters
        );
        resources.customMatchers = j$.util.clone(
          runnableResources[parentRunnableId].customMatchers
        );
        resources.customAsyncMatchers = j$.util.clone(
          runnableResources[parentRunnableId].customAsyncMatchers
        );
        resources.defaultStrategyFn =
          runnableResources[parentRunnableId].defaultStrategyFn;
      }

      runnableResources[id] = resources;
    };

    var clearResourcesForRunnable = function(id) {
      spyRegistry.clearSpies();
      delete runnableResources[id];
    };

    var beforeAndAfterFns = function(suite) {
      return function() {
        var befores = [],
          afters = [];

        while (suite) {
          befores = befores.concat(suite.beforeFns);
          afters = afters.concat(suite.afterFns);

          suite = suite.parentSuite;
        }

        return {
          befores: befores.reverse(),
          afters: afters
        };
      };
    };

    var getSpecName = function(spec, suite) {
      var fullName = [spec.description],
        suiteFullName = suite.getFullName();

      if (suiteFullName !== '') {
        fullName.unshift(suiteFullName);
      }
      return fullName.join(' ');
    };

    // TODO: we may just be able to pass in the fn instead of wrapping here
    var buildExpectationResult = j$.buildExpectationResult,
      exceptionFormatter = new j$.ExceptionFormatter(),
      expectationResultFactory = function(attrs) {
        attrs.messageFormatter = exceptionFormatter.message;
        attrs.stackFormatter = exceptionFormatter.stack;

        return buildExpectationResult(attrs);
      };

    /**
     * Sets whether Jasmine should throw an Error when an expectation fails.
     * This causes a spec to only have one expectation failure.
     * @name Env#throwOnExpectationFailure
     * @since 2.3.0
     * @function
     * @param {Boolean} value Whether to throw when a expectation fails
     * @deprecated Use the `oneFailurePerSpec` option with {@link Env#configure}
     */
    this.throwOnExpectationFailure = function(value) {
      this.deprecated(
        'Setting throwOnExpectationFailure directly on Env is deprecated and will be removed in a future version of Jasmine, please use the oneFailurePerSpec option in `configure`'
      );
      this.configure({ oneFailurePerSpec: !!value });
    };

    this.throwingExpectationFailures = function() {
      this.deprecated(
        'Getting throwingExpectationFailures directly from Env is deprecated and will be removed in a future version of Jasmine, please check the oneFailurePerSpec option from `configuration`'
      );
      return config.oneFailurePerSpec;
    };

    /**
     * Set whether to stop suite execution when a spec fails
     * @name Env#stopOnSpecFailure
     * @since 2.7.0
     * @function
     * @param {Boolean} value Whether to stop suite execution when a spec fails
     * @deprecated Use the `failFast` option with {@link Env#configure}
     */
    this.stopOnSpecFailure = function(value) {
      this.deprecated(
        'Setting stopOnSpecFailure directly is deprecated and will be removed in a future version of Jasmine, please use the failFast option in `configure`'
      );
      this.configure({ failFast: !!value });
    };

    this.stoppingOnSpecFailure = function() {
      this.deprecated(
        'Getting stoppingOnSpecFailure directly from Env is deprecated and will be removed in a future version of Jasmine, please check the failFast option from `configuration`'
      );
      return config.failFast;
    };

    /**
     * Set whether to randomize test execution order
     * @name Env#randomizeTests
     * @since 2.4.0
     * @function
     * @param {Boolean} value Whether to randomize execution order
     * @deprecated Use the `random` option with {@link Env#configure}
     */
    this.randomizeTests = function(value) {
      this.deprecated(
        'Setting randomizeTests directly is deprecated and will be removed in a future version of Jasmine, please use the random option in `configure`'
      );
      config.random = !!value;
    };

    this.randomTests = function() {
      this.deprecated(
        'Getting randomTests directly from Env is deprecated and will be removed in a future version of Jasmine, please check the random option from `configuration`'
      );
      return config.random;
    };

    /**
     * Set the random number seed for spec randomization
     * @name Env#seed
     * @since 2.4.0
     * @function
     * @param {Number} value The seed value
     * @deprecated Use the `seed` option with {@link Env#configure}
     */
    this.seed = function(value) {
      this.deprecated(
        'Setting seed directly is deprecated and will be removed in a future version of Jasmine, please use the seed option in `configure`'
      );
      if (value) {
        config.seed = value;
      }
      return config.seed;
    };

    this.hidingDisabled = function(value) {
      this.deprecated(
        'Getting hidingDisabled directly from Env is deprecated and will be removed in a future version of Jasmine, please check the hideDisabled option from `configuration`'
      );
      return config.hideDisabled;
    };

    /**
     * @name Env#hideDisabled
     * @since 3.2.0
     * @function
     */
    this.hideDisabled = function(value) {
      this.deprecated(
        'Setting hideDisabled directly is deprecated and will be removed in a future version of Jasmine, please use the hideDisabled option in `configure`'
      );
      config.hideDisabled = !!value;
    };

    this.deprecated = function(deprecation) {
      var runnable = currentRunnable() || topSuite;
      runnable.addDeprecationWarning(deprecation);
      if (
        typeof console !== 'undefined' &&
        typeof console.error === 'function'
      ) {
        console.error('DEPRECATION:', deprecation);
      }
    };

    var queueRunnerFactory = function(options, args) {
      var failFast = false;
      if (options.isLeaf) {
        failFast = config.oneFailurePerSpec;
      } else if (!options.isReporter) {
        failFast = config.failFast;
      }
      options.clearStack = options.clearStack || clearStack;
      options.timeout = {
        setTimeout: realSetTimeout,
        clearTimeout: realClearTimeout
      };
      options.fail = self.fail;
      options.globalErrors = globalErrors;
      options.completeOnFirstError = failFast;
      options.onException =
        options.onException ||
        function(e) {
          (currentRunnable() || topSuite).onException(e);
        };
      options.deprecated = self.deprecated;

      new j$.QueueRunner(options).execute(args);
    };

    var topSuite = new j$.Suite({
      env: this,
      id: getNextSuiteId(),
      description: 'Jasmine__TopLevel__Suite',
      expectationFactory: expectationFactory,
      asyncExpectationFactory: asyncExpectationFactory,
      expectationResultFactory: expectationResultFactory
    });
    defaultResourcesForRunnable(topSuite.id);
    currentDeclarationSuite = topSuite;

    this.topSuite = function() {
      return topSuite;
    };

    /**
     * This represents the available reporter callback for an object passed to {@link Env#addReporter}.
     * @interface Reporter
     * @see custom_reporter
     */
    var reporter = new j$.ReportDispatcher(
      [
        /**
         * `jasmineStarted` is called after all of the specs have been loaded, but just before execution starts.
         * @function
         * @name Reporter#jasmineStarted
         * @param {JasmineStartedInfo} suiteInfo Information about the full Jasmine suite that is being run
         * @param {Function} [done] Used to specify to Jasmine that this callback is asynchronous and Jasmine should wait until it has been called before moving on.
         * @returns {} Optionally return a Promise instead of using `done` to cause Jasmine to wait for completion.
         * @see async
         */
        'jasmineStarted',
        /**
         * When the entire suite has finished execution `jasmineDone` is called
         * @function
         * @name Reporter#jasmineDone
         * @param {JasmineDoneInfo} suiteInfo Information about the full Jasmine suite that just finished running.
         * @param {Function} [done] Used to specify to Jasmine that this callback is asynchronous and Jasmine should wait until it has been called before moving on.
         * @returns {} Optionally return a Promise instead of using `done` to cause Jasmine to wait for completion.
         * @see async
         */
        'jasmineDone',
        /**
         * `suiteStarted` is invoked when a `describe` starts to run
         * @function
         * @name Reporter#suiteStarted
         * @param {SuiteResult} result Information about the individual {@link describe} being run
         * @param {Function} [done] Used to specify to Jasmine that this callback is asynchronous and Jasmine should wait until it has been called before moving on.
         * @returns {} Optionally return a Promise instead of using `done` to cause Jasmine to wait for completion.
         * @see async
         */
        'suiteStarted',
        /**
         * `suiteDone` is invoked when all of the child specs and suites for a given suite have been run
         *
         * While jasmine doesn't require any specific functions, not defining a `suiteDone` will make it impossible for a reporter to know when a suite has failures in an `afterAll`.
         * @function
         * @name Reporter#suiteDone
         * @param {SuiteResult} result
         * @param {Function} [done] Used to specify to Jasmine that this callback is asynchronous and Jasmine should wait until it has been called before moving on.
         * @returns {} Optionally return a Promise instead of using `done` to cause Jasmine to wait for completion.
         * @see async
         */
        'suiteDone',
        /**
         * `specStarted` is invoked when an `it` starts to run (including associated `beforeEach` functions)
         * @function
         * @name Reporter#specStarted
         * @param {SpecResult} result Information about the individual {@link it} being run
         * @param {Function} [done] Used to specify to Jasmine that this callback is asynchronous and Jasmine should wait until it has been called before moving on.
         * @returns {} Optionally return a Promise instead of using `done` to cause Jasmine to wait for completion.
         * @see async
         */
        'specStarted',
        /**
         * `specDone` is invoked when an `it` and its associated `beforeEach` and `afterEach` functions have been run.
         *
         * While jasmine doesn't require any specific functions, not defining a `specDone` will make it impossible for a reporter to know when a spec has failed.
         * @function
         * @name Reporter#specDone
         * @param {SpecResult} result
         * @param {Function} [done] Used to specify to Jasmine that this callback is asynchronous and Jasmine should wait until it has been called before moving on.
         * @returns {} Optionally return a Promise instead of using `done` to cause Jasmine to wait for completion.
         * @see async
         */
        'specDone'
      ],
      queueRunnerFactory
    );

    this.execute = function(runnablesToRun) {
      installGlobalErrors();

      if (!runnablesToRun) {
        if (focusedRunnables.length) {
          runnablesToRun = focusedRunnables;
        } else {
          runnablesToRun = [topSuite.id];
        }
      }

      var order = new j$.Order({
        random: config.random,
        seed: config.seed
      });

      var processor = new j$.TreeProcessor({
        tree: topSuite,
        runnableIds: runnablesToRun,
        queueRunnerFactory: queueRunnerFactory,
        failSpecWithNoExpectations: config.failSpecWithNoExpectations,
        nodeStart: function(suite, next) {
          currentlyExecutingSuites.push(suite);
          defaultResourcesForRunnable(suite.id, suite.parentSuite.id);
          reporter.suiteStarted(suite.result, next);
          suite.startTimer();
        },
        nodeComplete: function(suite, result, next) {
          if (suite !== currentSuite()) {
            throw new Error('Tried to complete the wrong suite');
          }

          clearResourcesForRunnable(suite.id);
          currentlyExecutingSuites.pop();

          if (result.status === 'failed') {
            hasFailures = true;
          }
          suite.endTimer();
          reporter.suiteDone(result, next);
        },
        orderChildren: function(node) {
          return order.sort(node.children);
        },
        excludeNode: function(spec) {
          return !config.specFilter(spec);
        }
      });

      if (!processor.processTree().valid) {
        throw new Error(
          'Invalid order: would cause a beforeAll or afterAll to be run multiple times'
        );
      }

      var jasmineTimer = new j$.Timer();
      jasmineTimer.start();

      /**
       * Information passed to the {@link Reporter#jasmineStarted} event.
       * @typedef JasmineStartedInfo
       * @property {Int} totalSpecsDefined - The total number of specs defined in this suite.
       * @property {Order} order - Information about the ordering (random or not) of this execution of the suite.
       */
      reporter.jasmineStarted(
        {
          totalSpecsDefined: totalSpecsDefined,
          order: order
        },
        function() {
          currentlyExecutingSuites.push(topSuite);

          processor.execute(function() {
            clearResourcesForRunnable(topSuite.id);
            currentlyExecutingSuites.pop();
            var overallStatus, incompleteReason;

            if (hasFailures || topSuite.result.failedExpectations.length > 0) {
              overallStatus = 'failed';
            } else if (focusedRunnables.length > 0) {
              overallStatus = 'incomplete';
              incompleteReason = 'fit() or fdescribe() was found';
            } else if (totalSpecsDefined === 0) {
              overallStatus = 'incomplete';
              incompleteReason = 'No specs found';
            } else {
              overallStatus = 'passed';
            }

            /**
             * Information passed to the {@link Reporter#jasmineDone} event.
             * @typedef JasmineDoneInfo
             * @property {OverallStatus} overallStatus - The overall result of the suite: 'passed', 'failed', or 'incomplete'.
             * @property {Int} totalTime - The total time (in ms) that it took to execute the suite
             * @property {IncompleteReason} incompleteReason - Explanation of why the suite was incomplete.
             * @property {Order} order - Information about the ordering (random or not) of this execution of the suite.
             * @property {Expectation[]} failedExpectations - List of expectations that failed in an {@link afterAll} at the global level.
             * @property {Expectation[]} deprecationWarnings - List of deprecation warnings that occurred at the global level.
             */
            reporter.jasmineDone(
              {
                overallStatus: overallStatus,
                totalTime: jasmineTimer.elapsed(),
                incompleteReason: incompleteReason,
                order: order,
                failedExpectations: topSuite.result.failedExpectations,
                deprecationWarnings: topSuite.result.deprecationWarnings
              },
              function() {}
            );
          });
        }
      );
    };

    /**
     * Add a custom reporter to the Jasmine environment.
     * @name Env#addReporter
     * @since 2.0.0
     * @function
     * @param {Reporter} reporterToAdd The reporter to be added.
     * @see custom_reporter
     */
    this.addReporter = function(reporterToAdd) {
      reporter.addReporter(reporterToAdd);
    };

    /**
     * Provide a fallback reporter if no other reporters have been specified.
     * @name Env#provideFallbackReporter
     * @since 2.5.0
     * @function
     * @param {Reporter} reporterToAdd The reporter
     * @see custom_reporter
     */
    this.provideFallbackReporter = function(reporterToAdd) {
      reporter.provideFallbackReporter(reporterToAdd);
    };

    /**
     * Clear all registered reporters
     * @name Env#clearReporters
     * @since 2.5.2
     * @function
     */
    this.clearReporters = function() {
      reporter.clearReporters();
    };

    var spyFactory = new j$.SpyFactory(
      function getCustomStrategies() {
        var runnable = currentRunnable();

        if (runnable) {
          return runnableResources[runnable.id].customSpyStrategies;
        }

        return {};
      },
      function getDefaultStrategyFn() {
        var runnable = currentRunnable();

        if (runnable) {
          return runnableResources[runnable.id].defaultStrategyFn;
        }

        return undefined;
      },
      function getPromise() {
        return customPromise || global.Promise;
      }
    );

    var spyRegistry = new j$.SpyRegistry({
      currentSpies: function() {
        if (!currentRunnable()) {
          throw new Error(
            'Spies must be created in a before function or a spec'
          );
        }
        return runnableResources[currentRunnable().id].spies;
      },
      createSpy: function(name, originalFn) {
        return self.createSpy(name, originalFn);
      }
    });

    this.allowRespy = function(allow) {
      spyRegistry.allowRespy(allow);
    };

    this.spyOn = function() {
      return spyRegistry.spyOn.apply(spyRegistry, arguments);
    };

    this.spyOnProperty = function() {
      return spyRegistry.spyOnProperty.apply(spyRegistry, arguments);
    };

    this.spyOnAllFunctions = function() {
      return spyRegistry.spyOnAllFunctions.apply(spyRegistry, arguments);
    };

    this.createSpy = function(name, originalFn) {
      if (arguments.length === 1 && j$.isFunction_(name)) {
        originalFn = name;
        name = originalFn.name;
      }

      return spyFactory.createSpy(name, originalFn);
    };

    this.createSpyObj = function(baseName, methodNames, propertyNames) {
      return spyFactory.createSpyObj(baseName, methodNames, propertyNames);
    };

    var ensureIsFunction = function(fn, caller) {
      if (!j$.isFunction_(fn)) {
        throw new Error(
          caller + ' expects a function argument; received ' + j$.getType_(fn)
        );
      }
    };

    var ensureIsFunctionOrAsync = function(fn, caller) {
      if (!j$.isFunction_(fn) && !j$.isAsyncFunction_(fn)) {
        throw new Error(
          caller + ' expects a function argument; received ' + j$.getType_(fn)
        );
      }
    };

    function ensureIsNotNested(method) {
      var runnable = currentRunnable();
      if (runnable !== null && runnable !== undefined) {
        throw new Error(
          "'" + method + "' should only be used in 'describe' function"
        );
      }
    }

    var suiteFactory = function(description) {
      var suite = new j$.Suite({
        env: self,
        id: getNextSuiteId(),
        description: description,
        parentSuite: currentDeclarationSuite,
        expectationFactory: expectationFactory,
        asyncExpectationFactory: asyncExpectationFactory,
        expectationResultFactory: expectationResultFactory,
        throwOnExpectationFailure: config.oneFailurePerSpec
      });

      return suite;
    };

    this.describe = function(description, specDefinitions) {
      ensureIsNotNested('describe');
      ensureIsFunction(specDefinitions, 'describe');
      var suite = suiteFactory(description);
      if (specDefinitions.length > 0) {
        throw new Error('describe does not expect any arguments');
      }
      if (currentDeclarationSuite.markedPending) {
        suite.pend();
      }
      addSpecsToSuite(suite, specDefinitions);
      return suite;
    };

    this.xdescribe = function(description, specDefinitions) {
      ensureIsNotNested('xdescribe');
      ensureIsFunction(specDefinitions, 'xdescribe');
      var suite = suiteFactory(description);
      suite.pend();
      addSpecsToSuite(suite, specDefinitions);
      return suite;
    };

    var focusedRunnables = [];

    this.fdescribe = function(description, specDefinitions) {
      ensureIsNotNested('fdescribe');
      ensureIsFunction(specDefinitions, 'fdescribe');
      var suite = suiteFactory(description);
      suite.isFocused = true;

      focusedRunnables.push(suite.id);
      unfocusAncestor();
      addSpecsToSuite(suite, specDefinitions);

      return suite;
    };

    function addSpecsToSuite(suite, specDefinitions) {
      var parentSuite = currentDeclarationSuite;
      parentSuite.addChild(suite);
      currentDeclarationSuite = suite;

      var declarationError = null;
      try {
        specDefinitions.call(suite);
      } catch (e) {
        declarationError = e;
      }

      if (declarationError) {
        suite.onException(declarationError);
      }

      currentDeclarationSuite = parentSuite;
    }

    function findFocusedAncestor(suite) {
      while (suite) {
        if (suite.isFocused) {
          return suite.id;
        }
        suite = suite.parentSuite;
      }

      return null;
    }

    function unfocusAncestor() {
      var focusedAncestor = findFocusedAncestor(currentDeclarationSuite);
      if (focusedAncestor) {
        for (var i = 0; i < focusedRunnables.length; i++) {
          if (focusedRunnables[i] === focusedAncestor) {
            focusedRunnables.splice(i, 1);
            break;
          }
        }
      }
    }

    var specFactory = function(description, fn, suite, timeout) {
      totalSpecsDefined++;
      var spec = new j$.Spec({
        id: getNextSpecId(),
        beforeAndAfterFns: beforeAndAfterFns(suite),
        expectationFactory: expectationFactory,
        asyncExpectationFactory: asyncExpectationFactory,
        resultCallback: specResultCallback,
        getSpecName: function(spec) {
          return getSpecName(spec, suite);
        },
        onStart: specStarted,
        description: description,
        expectationResultFactory: expectationResultFactory,
        queueRunnerFactory: queueRunnerFactory,
        userContext: function() {
          return suite.clonedSharedUserContext();
        },
        queueableFn: {
          fn: fn,
          timeout: timeout || 0
        },
        throwOnExpectationFailure: config.oneFailurePerSpec,
        timer: new j$.Timer()
      });
      return spec;

      function specResultCallback(result, next) {
        clearResourcesForRunnable(spec.id);
        currentSpec = null;

        if (result.status === 'failed') {
          hasFailures = true;
        }

        reporter.specDone(result, next);
      }

      function specStarted(spec, next) {
        currentSpec = spec;
        defaultResourcesForRunnable(spec.id, suite.id);
        reporter.specStarted(spec.result, next);
      }
    };

    this.it = function(description, fn, timeout) {
      ensureIsNotNested('it');
      // it() sometimes doesn't have a fn argument, so only check the type if
      // it's given.
      if (arguments.length > 1 && typeof fn !== 'undefined') {
        ensureIsFunctionOrAsync(fn, 'it');
      }
      var spec = specFactory(description, fn, currentDeclarationSuite, timeout);
      if (currentDeclarationSuite.markedPending) {
        spec.pend();
      }
      currentDeclarationSuite.addChild(spec);
      return spec;
    };

    this.xit = function(description, fn, timeout) {
      ensureIsNotNested('xit');
      // xit(), like it(), doesn't always have a fn argument, so only check the
      // type when needed.
      if (arguments.length > 1 && typeof fn !== 'undefined') {
        ensureIsFunctionOrAsync(fn, 'xit');
      }
      var spec = this.it.apply(this, arguments);
      spec.pend('Temporarily disabled with xit');
      return spec;
    };

    this.fit = function(description, fn, timeout) {
      ensureIsNotNested('fit');
      ensureIsFunctionOrAsync(fn, 'fit');
      var spec = specFactory(description, fn, currentDeclarationSuite, timeout);
      currentDeclarationSuite.addChild(spec);
      focusedRunnables.push(spec.id);
      unfocusAncestor();
      return spec;
    };

    this.expect = function(actual) {
      if (!currentRunnable()) {
        throw new Error(
          "'expect' was used when there was no current spec, this could be because an asynchronous test timed out"
        );
      }

      return currentRunnable().expect(actual);
    };

    this.expectAsync = function(actual) {
      if (!currentRunnable()) {
        throw new Error(
          "'expectAsync' was used when there was no current spec, this could be because an asynchronous test timed out"
        );
      }

      return currentRunnable().expectAsync(actual);
    };

    this.beforeEach = function(beforeEachFunction, timeout) {
      ensureIsNotNested('beforeEach');
      ensureIsFunctionOrAsync(beforeEachFunction, 'beforeEach');
      currentDeclarationSuite.beforeEach({
        fn: beforeEachFunction,
        timeout: timeout || 0
      });
    };

    this.beforeAll = function(beforeAllFunction, timeout) {
      ensureIsNotNested('beforeAll');
      ensureIsFunctionOrAsync(beforeAllFunction, 'beforeAll');
      currentDeclarationSuite.beforeAll({
        fn: beforeAllFunction,
        timeout: timeout || 0
      });
    };

    this.afterEach = function(afterEachFunction, timeout) {
      ensureIsNotNested('afterEach');
      ensureIsFunctionOrAsync(afterEachFunction, 'afterEach');
      afterEachFunction.isCleanup = true;
      currentDeclarationSuite.afterEach({
        fn: afterEachFunction,
        timeout: timeout || 0
      });
    };

    this.afterAll = function(afterAllFunction, timeout) {
      ensureIsNotNested('afterAll');
      ensureIsFunctionOrAsync(afterAllFunction, 'afterAll');
      currentDeclarationSuite.afterAll({
        fn: afterAllFunction,
        timeout: timeout || 0
      });
    };

    this.pending = function(message) {
      var fullMessage = j$.Spec.pendingSpecExceptionMessage;
      if (message) {
        fullMessage += message;
      }
      throw fullMessage;
    };

    this.fail = function(error) {
      if (!currentRunnable()) {
        throw new Error(
          "'fail' was used when there was no current spec, this could be because an asynchronous test timed out"
        );
      }

      var message = 'Failed';
      if (error) {
        message += ': ';
        if (error.message) {
          message += error.message;
        } else if (j$.isString_(error)) {
          message += error;
        } else {
          // pretty print all kind of objects. This includes arrays.
          message += j$.pp(error);
        }
      }

      currentRunnable().addExpectationResult(false, {
        matcherName: '',
        passed: false,
        expected: '',
        actual: '',
        message: message,
        error: error && error.message ? error : null
      });

      if (config.oneFailurePerSpec) {
        throw new Error(message);
      }
    };
  }

  return Env;
};

getJasmineRequireObj().JsApiReporter = function(j$) {
  /**
   * @name jsApiReporter
   * @classdesc {@link Reporter} added by default in `boot.js` to record results for retrieval in javascript code. An instance is made available as `jsApiReporter` on the global object.
   * @class
   * @hideconstructor
   */
  function JsApiReporter(options) {
    var timer = options.timer || j$.noopTimer,
      status = 'loaded';

    this.started = false;
    this.finished = false;
    this.runDetails = {};

    this.jasmineStarted = function() {
      this.started = true;
      status = 'started';
      timer.start();
    };

    var executionTime;

    this.jasmineDone = function(runDetails) {
      this.finished = true;
      this.runDetails = runDetails;
      executionTime = timer.elapsed();
      status = 'done';
    };

    /**
     * Get the current status for the Jasmine environment.
     * @name jsApiReporter#status
     * @since 2.0.0
     * @function
     * @return {String} - One of `loaded`, `started`, or `done`
     */
    this.status = function() {
      return status;
    };

    var suites = [],
      suites_hash = {};

    this.suiteStarted = function(result) {
      suites_hash[result.id] = result;
    };

    this.suiteDone = function(result) {
      storeSuite(result);
    };

    /**
     * Get the results for a set of suites.
     *
     * Retrievable in slices for easier serialization.
     * @name jsApiReporter#suiteResults
     * @since 2.1.0
     * @function
     * @param {Number} index - The position in the suites list to start from.
     * @param {Number} length - Maximum number of suite results to return.
     * @return {SuiteResult[]}
     */
    this.suiteResults = function(index, length) {
      return suites.slice(index, index + length);
    };

    function storeSuite(result) {
      suites.push(result);
      suites_hash[result.id] = result;
    }

    /**
     * Get all of the suites in a single object, with their `id` as the key.
     * @name jsApiReporter#suites
     * @since 2.0.0
     * @function
     * @return {Object} - Map of suite id to {@link SuiteResult}
     */
    this.suites = function() {
      return suites_hash;
    };

    var specs = [];

    this.specDone = function(result) {
      specs.push(result);
    };

    /**
     * Get the results for a set of specs.
     *
     * Retrievable in slices for easier serialization.
     * @name jsApiReporter#specResults
     * @since 2.0.0
     * @function
     * @param {Number} index - The position in the specs list to start from.
     * @param {Number} length - Maximum number of specs results to return.
     * @return {SpecResult[]}
     */
    this.specResults = function(index, length) {
      return specs.slice(index, index + length);
    };

    /**
     * Get all spec results.
     * @name jsApiReporter#specs
     * @since 2.0.0
     * @function
     * @return {SpecResult[]}
     */
    this.specs = function() {
      return specs;
    };

    /**
     * Get the number of milliseconds it took for the full Jasmine suite to run.
     * @name jsApiReporter#executionTime
     * @since 2.0.0
     * @function
     * @return {Number}
     */
    this.executionTime = function() {
      return executionTime;
    };
  }

  return JsApiReporter;
};

getJasmineRequireObj().Any = function(j$) {

  function Any(expectedObject) {
    if (typeof expectedObject === 'undefined') {
      throw new TypeError(
        'jasmine.any() expects to be passed a constructor function. ' +
        'Please pass one or use jasmine.anything() to match any object.'
      );
    }
    this.expectedObject = expectedObject;
  }

  Any.prototype.asymmetricMatch = function(other) {
    if (this.expectedObject == String) {
      return typeof other == 'string' || other instanceof String;
    }

    if (this.expectedObject == Number) {
      return typeof other == 'number' || other instanceof Number;
    }

    if (this.expectedObject == Function) {
      return typeof other == 'function' || other instanceof Function;
    }

    if (this.expectedObject == Object) {
      return other !== null && typeof other == 'object';
    }

    if (this.expectedObject == Boolean) {
      return typeof other == 'boolean';
    }

    /* jshint -W122 */
    /* global Symbol */
    if (typeof Symbol != 'undefined' && this.expectedObject == Symbol) {
      return typeof other == 'symbol';
    }
    /* jshint +W122 */

    return other instanceof this.expectedObject;
  };

  Any.prototype.jasmineToString = function() {
    return '<jasmine.any(' + j$.fnNameFor(this.expectedObject) + ')>';
  };

  return Any;
};

getJasmineRequireObj().Anything = function(j$) {

  function Anything() {}

  Anything.prototype.asymmetricMatch = function(other) {
    return !j$.util.isUndefined(other) && other !== null;
  };

  Anything.prototype.jasmineToString = function() {
    return '<jasmine.anything>';
  };

  return Anything;
};

getJasmineRequireObj().ArrayContaining = function(j$) {
  function ArrayContaining(sample) {
    this.sample = sample;
  }

  ArrayContaining.prototype.asymmetricMatch = function(other, customTesters) {
    if (!j$.isArray_(this.sample)) {
      throw new Error('You must provide an array to arrayContaining, not ' + j$.pp(this.sample) + '.');
    }

    // If the actual parameter is not an array, we can fail immediately, since it couldn't
    // possibly be an "array containing" anything. However, we also want an empty sample
    // array to match anything, so we need to double-check we aren't in that case
    if (!j$.isArray_(other) && this.sample.length > 0) {
      return false;
    }

    for (var i = 0; i < this.sample.length; i++) {
      var item = this.sample[i];
      if (!j$.matchersUtil.contains(other, item, customTesters)) {
        return false;
      }
    }

    return true;
  };

  ArrayContaining.prototype.jasmineToString = function () {
    return '<jasmine.arrayContaining(' + j$.pp(this.sample) +')>';
  };

  return ArrayContaining;
};

getJasmineRequireObj().ArrayWithExactContents = function(j$) {

  function ArrayWithExactContents(sample) {
    this.sample = sample;
  }

  ArrayWithExactContents.prototype.asymmetricMatch = function(other, customTesters) {
    if (!j$.isArray_(this.sample)) {
      throw new Error('You must provide an array to arrayWithExactContents, not ' + j$.pp(this.sample) + '.');
    }

    if (this.sample.length !== other.length) {
      return false;
    }

    for (var i = 0; i < this.sample.length; i++) {
      var item = this.sample[i];
      if (!j$.matchersUtil.contains(other, item, customTesters)) {
        return false;
      }
    }

    return true;
  };

  ArrayWithExactContents.prototype.jasmineToString = function() {
    return '<jasmine.arrayWithExactContents ' + j$.pp(this.sample) + '>';
  };

  return ArrayWithExactContents;
};

getJasmineRequireObj().Empty = function (j$) {

  function Empty() {}

  Empty.prototype.asymmetricMatch = function (other) {
    if (j$.isString_(other) || j$.isArray_(other) || j$.isTypedArray_(other)) {
      return other.length === 0;
    }

    if (j$.isMap(other) || j$.isSet(other)) {
      return other.size === 0;
    }

    if (j$.isObject_(other)) {
      return Object.keys(other).length === 0;
    }
    return false;
  };

  Empty.prototype.jasmineToString = function () {
    return '<jasmine.empty>';
  };

  return Empty;
};

getJasmineRequireObj().Falsy = function(j$) {

  function Falsy() {}

  Falsy.prototype.asymmetricMatch = function(other) {
    return !other;
  };

  Falsy.prototype.jasmineToString = function() {
    return '<jasmine.falsy>';
  };

  return Falsy;
};

getJasmineRequireObj().MapContaining = function(j$) {
  function MapContaining(sample) {
    if (!j$.isMap(sample)) {
      throw new Error('You must provide a map to `mapContaining`, not ' + j$.pp(sample));
    }

    this.sample = sample;
  }

  MapContaining.prototype.asymmetricMatch = function(other, customTesters) {
    if (!j$.isMap(other)) return false;

    var hasAllMatches = true;
    j$.util.forEachBreakable(this.sample, function(breakLoop, value, key) {
      // for each key/value pair in `sample`
      // there should be at least one pair in `other` whose key and value both match
      var hasMatch = false;
      j$.util.forEachBreakable(other, function(oBreakLoop, oValue, oKey) {
        if (
          j$.matchersUtil.equals(oKey, key, customTesters)
          && j$.matchersUtil.equals(oValue, value, customTesters)
        ) {
          hasMatch = true;
          oBreakLoop();
        }
      });
      if (!hasMatch) {
        hasAllMatches = false;
        breakLoop();
      }
    });

    return hasAllMatches;
  };

  MapContaining.prototype.jasmineToString = function() {
    return '<jasmine.mapContaining(' + j$.pp(this.sample) + ')>';
  };

  return MapContaining;
};

getJasmineRequireObj().NotEmpty = function (j$) {

  function NotEmpty() {}

  NotEmpty.prototype.asymmetricMatch = function (other) {
    if (j$.isString_(other) || j$.isArray_(other) || j$.isTypedArray_(other)) {
      return other.length !== 0;
    }

    if (j$.isMap(other) || j$.isSet(other)) {
      return other.size !== 0;
    }

    if (j$.isObject_(other)) {
      return Object.keys(other).length !== 0;
    }

    return false;
  };

  NotEmpty.prototype.jasmineToString = function () {
    return '<jasmine.notEmpty>';
  };

  return NotEmpty;
};

getJasmineRequireObj().ObjectContaining = function(j$) {

  function ObjectContaining(sample) {
    this.sample = sample;
  }

  function getPrototype(obj) {
    if (Object.getPrototypeOf) {
      return Object.getPrototypeOf(obj);
    }

    if (obj.constructor.prototype == obj) {
      return null;
    }

    return obj.constructor.prototype;
  }

  function hasProperty(obj, property) {
    if (!obj) {
      return false;
    }

    if (Object.prototype.hasOwnProperty.call(obj, property)) {
      return true;
    }

    return hasProperty(getPrototype(obj), property);
  }

  ObjectContaining.prototype.asymmetricMatch = function(other, customTesters) {
    if (typeof(this.sample) !== 'object') { throw new Error('You must provide an object to objectContaining, not \''+this.sample+'\'.'); }

    for (var property in this.sample) {
      if (!hasProperty(other, property) ||
          !j$.matchersUtil.equals(this.sample[property], other[property], customTesters)) {
        return false;
      }
    }

    return true;
  };

  ObjectContaining.prototype.jasmineToString = function() {
    return '<jasmine.objectContaining(' + j$.pp(this.sample) + ')>';
  };

  return ObjectContaining;
};

getJasmineRequireObj().SetContaining = function(j$) {
  function SetContaining(sample) {
    if (!j$.isSet(sample)) {
      throw new Error('You must provide a set to `setContaining`, not ' + j$.pp(sample));
    }

    this.sample = sample;
  }

  SetContaining.prototype.asymmetricMatch = function(other, customTesters) {
    if (!j$.isSet(other)) return false;

    var hasAllMatches = true;
    j$.util.forEachBreakable(this.sample, function(breakLoop, item) {
      // for each item in `sample` there should be at least one matching item in `other`
      // (not using `j$.matchersUtil.contains` because it compares set members by reference,
      // not by deep value equality)
      var hasMatch = false;
      j$.util.forEachBreakable(other, function(oBreakLoop, oItem) {
        if (j$.matchersUtil.equals(oItem, item, customTesters)) {
          hasMatch = true;
          oBreakLoop();
        }
      });
      if (!hasMatch) {
        hasAllMatches = false;
        breakLoop();
      }
    });

    return hasAllMatches;
  };

  SetContaining.prototype.jasmineToString = function() {
    return '<jasmine.setContaining(' + j$.pp(this.sample) + ')>';
  };

  return SetContaining;
};

getJasmineRequireObj().StringMatching = function(j$) {

  function StringMatching(expected) {
    if (!j$.isString_(expected) && !j$.isA_('RegExp', expected)) {
      throw new Error('Expected is not a String or a RegExp');
    }

    this.regexp = new RegExp(expected);
  }

  StringMatching.prototype.asymmetricMatch = function(other) {
    return this.regexp.test(other);
  };

  StringMatching.prototype.jasmineToString = function() {
    return '<jasmine.stringMatching(' + this.regexp + ')>';
  };

  return StringMatching;
};

getJasmineRequireObj().Truthy = function(j$) {

  function Truthy() {}

  Truthy.prototype.asymmetricMatch = function(other) {
    return !!other;
  };

  Truthy.prototype.jasmineToString = function() {
    return '<jasmine.truthy>';
  };

  return Truthy;
};

getJasmineRequireObj().CallTracker = function(j$) {
  /**
   * @namespace Spy#calls
   * @since 2.0.0
   */
  function CallTracker() {
    var calls = [];
    var opts = {};

    this.track = function(context) {
      if (opts.cloneArgs) {
        context.args = j$.util.cloneArgs(context.args);
      }
      calls.push(context);
    };

    /**
     * Check whether this spy has been invoked.
     * @name Spy#calls#any
     * @since 2.0.0
     * @function
     * @return {Boolean}
     */
    this.any = function() {
      return !!calls.length;
    };

    /**
     * Get the number of invocations of this spy.
     * @name Spy#calls#count
     * @since 2.0.0
     * @function
     * @return {Integer}
     */
    this.count = function() {
      return calls.length;
    };

    /**
     * Get the arguments that were passed to a specific invocation of this spy.
     * @name Spy#calls#argsFor
     * @since 2.0.0
     * @function
     * @param {Integer} index The 0-based invocation index.
     * @return {Array}
     */
    this.argsFor = function(index) {
      var call = calls[index];
      return call ? call.args : [];
    };

    /**
     * Get the raw calls array for this spy.
     * @name Spy#calls#all
     * @since 2.0.0
     * @function
     * @return {Spy.callData[]}
     */
    this.all = function() {
      return calls;
    };

    /**
     * Get all of the arguments for each invocation of this spy in the order they were received.
     * @name Spy#calls#allArgs
     * @since 2.0.0
     * @function
     * @return {Array}
     */
    this.allArgs = function() {
      var callArgs = [];
      for (var i = 0; i < calls.length; i++) {
        callArgs.push(calls[i].args);
      }

      return callArgs;
    };

    /**
     * Get the first invocation of this spy.
     * @name Spy#calls#first
     * @since 2.0.0
     * @function
     * @return {ObjecSpy.callData}
     */
    this.first = function() {
      return calls[0];
    };

    /**
     * Get the most recent invocation of this spy.
     * @name Spy#calls#mostRecent
     * @since 2.0.0
     * @function
     * @return {ObjecSpy.callData}
     */
    this.mostRecent = function() {
      return calls[calls.length - 1];
    };

    /**
     * Reset this spy as if it has never been called.
     * @name Spy#calls#reset
     * @since 2.0.0
     * @function
     */
    this.reset = function() {
      calls = [];
    };

    /**
     * Set this spy to do a shallow clone of arguments passed to each invocation.
     * @name Spy#calls#saveArgumentsByValue
     * @since 2.5.0
     * @function
     */
    this.saveArgumentsByValue = function() {
      opts.cloneArgs = true;
    };
  }

  return CallTracker;
};

getJasmineRequireObj().clearStack = function(j$) {
  var maxInlineCallCount = 10;

  function messageChannelImpl(global, setTimeout) {
    var channel = new global.MessageChannel(),
      head = {},
      tail = head;

    var taskRunning = false;
    channel.port1.onmessage = function() {
      head = head.next;
      var task = head.task;
      delete head.task;

      if (taskRunning) {
        global.setTimeout(task, 0);
      } else {
        try {
          taskRunning = true;
          task();
        } finally {
          taskRunning = false;
        }
      }
    };

    var currentCallCount = 0;
    return function clearStack(fn) {
      currentCallCount++;

      if (currentCallCount < maxInlineCallCount) {
        tail = tail.next = { task: fn };
        channel.port2.postMessage(0);
      } else {
        currentCallCount = 0;
        setTimeout(fn);
      }
    };
  }

  function getClearStack(global) {
    var currentCallCount = 0;
    var realSetTimeout = global.setTimeout;
    var setTimeoutImpl = function clearStack(fn) {
      Function.prototype.apply.apply(realSetTimeout, [global, [fn, 0]]);
    };

    if (j$.isFunction_(global.setImmediate)) {
      var realSetImmediate = global.setImmediate;
      return function(fn) {
        currentCallCount++;

        if (currentCallCount < maxInlineCallCount) {
          realSetImmediate(fn);
        } else {
          currentCallCount = 0;

          setTimeoutImpl(fn);
        }
      };
    } else if (!j$.util.isUndefined(global.MessageChannel)) {
      return messageChannelImpl(global, setTimeoutImpl);
    } else {
      return setTimeoutImpl;
    }
  }

  return getClearStack;
};

getJasmineRequireObj().Clock = function() {
  /* global process */
  var NODE_JS =
    typeof process !== 'undefined' &&
    process.versions &&
    typeof process.versions.node === 'string';

  /**
   * _Note:_ Do not construct this directly, Jasmine will make one during booting. You can get the current clock with {@link jasmine.clock}.
   * @class Clock
   * @classdesc Jasmine's mock clock is used when testing time dependent code.
   */
  function Clock(global, delayedFunctionSchedulerFactory, mockDate) {
    var self = this,
      realTimingFunctions = {
        setTimeout: global.setTimeout,
        clearTimeout: global.clearTimeout,
        setInterval: global.setInterval,
        clearInterval: global.clearInterval
      },
      fakeTimingFunctions = {
        setTimeout: setTimeout,
        clearTimeout: clearTimeout,
        setInterval: setInterval,
        clearInterval: clearInterval
      },
      installed = false,
      delayedFunctionScheduler,
      timer;

    self.FakeTimeout = FakeTimeout;

    /**
     * Install the mock clock over the built-in methods.
     * @name Clock#install
     * @since 2.0.0
     * @function
     * @return {Clock}
     */
    self.install = function() {
      if (!originalTimingFunctionsIntact()) {
        throw new Error(
          'Jasmine Clock was unable to install over custom global timer functions. Is the clock already installed?'
        );
      }
      replace(global, fakeTimingFunctions);
      timer = fakeTimingFunctions;
      delayedFunctionScheduler = delayedFunctionSchedulerFactory();
      installed = true;

      return self;
    };

    /**
     * Uninstall the mock clock, returning the built-in methods to their places.
     * @name Clock#uninstall
     * @since 2.0.0
     * @function
     */
    self.uninstall = function() {
      delayedFunctionScheduler = null;
      mockDate.uninstall();
      replace(global, realTimingFunctions);

      timer = realTimingFunctions;
      installed = false;
    };

    /**
     * Execute a function with a mocked Clock
     *
     * The clock will be {@link Clock#install|install}ed before the function is called and {@link Clock#uninstall|uninstall}ed in a `finally` after the function completes.
     * @name Clock#withMock
     * @since 2.3.0
     * @function
     * @param {Function} closure The function to be called.
     */
    self.withMock = function(closure) {
      this.install();
      try {
        closure();
      } finally {
        this.uninstall();
      }
    };

    /**
     * Instruct the installed Clock to also mock the date returned by `new Date()`
     * @name Clock#mockDate
     * @since 2.1.0
     * @function
     * @param {Date} [initialDate=now] The `Date` to provide.
     */
    self.mockDate = function(initialDate) {
      mockDate.install(initialDate);
    };

    self.setTimeout = function(fn, delay, params) {
      return Function.prototype.apply.apply(timer.setTimeout, [
        global,
        arguments
      ]);
    };

    self.setInterval = function(fn, delay, params) {
      return Function.prototype.apply.apply(timer.setInterval, [
        global,
        arguments
      ]);
    };

    self.clearTimeout = function(id) {
      return Function.prototype.call.apply(timer.clearTimeout, [global, id]);
    };

    self.clearInterval = function(id) {
      return Function.prototype.call.apply(timer.clearInterval, [global, id]);
    };

    /**
     * Tick the Clock forward, running any enqueued timeouts along the way
     * @name Clock#tick
     * @since 1.3.0
     * @function
     * @param {int} millis The number of milliseconds to tick.
     */
    self.tick = function(millis) {
      if (installed) {
        delayedFunctionScheduler.tick(millis, function(millis) {
          mockDate.tick(millis);
        });
      } else {
        throw new Error(
          'Mock clock is not installed, use jasmine.clock().install()'
        );
      }
    };

    return self;

    function originalTimingFunctionsIntact() {
      return (
        global.setTimeout === realTimingFunctions.setTimeout &&
        global.clearTimeout === realTimingFunctions.clearTimeout &&
        global.setInterval === realTimingFunctions.setInterval &&
        global.clearInterval === realTimingFunctions.clearInterval
      );
    }

    function replace(dest, source) {
      for (var prop in source) {
        dest[prop] = source[prop];
      }
    }

    function setTimeout(fn, delay) {
      if (!NODE_JS) {
        return delayedFunctionScheduler.scheduleFunction(
          fn,
          delay,
          argSlice(arguments, 2)
        );
      }

      var timeout = new FakeTimeout();

      delayedFunctionScheduler.scheduleFunction(
        fn,
        delay,
        argSlice(arguments, 2),
        false,
        timeout
      );

      return timeout;
    }

    function clearTimeout(id) {
      return delayedFunctionScheduler.removeFunctionWithId(id);
    }

    function setInterval(fn, interval) {
      if (!NODE_JS) {
        return delayedFunctionScheduler.scheduleFunction(
          fn,
          interval,
          argSlice(arguments, 2),
          true
        );
      }

      var timeout = new FakeTimeout();

      delayedFunctionScheduler.scheduleFunction(
        fn,
        interval,
        argSlice(arguments, 2),
        true,
        timeout
      );

      return timeout;
    }

    function clearInterval(id) {
      return delayedFunctionScheduler.removeFunctionWithId(id);
    }

    function argSlice(argsObj, n) {
      return Array.prototype.slice.call(argsObj, n);
    }
  }

  /**
   * Mocks Node.js Timeout class
   */
  function FakeTimeout() {}

  FakeTimeout.prototype.ref = function() {
    return this;
  };

  FakeTimeout.prototype.unref = function() {
    return this;
  };

  return Clock;
};

getJasmineRequireObj().DelayedFunctionScheduler = function(j$) {
  function DelayedFunctionScheduler() {
    var self = this;
    var scheduledLookup = [];
    var scheduledFunctions = {};
    var currentTime = 0;
    var delayedFnCount = 0;
    var deletedKeys = [];

    self.tick = function(millis, tickDate) {
      millis = millis || 0;
      var endTime = currentTime + millis;

      runScheduledFunctions(endTime, tickDate);
      currentTime = endTime;
    };

    self.scheduleFunction = function(
      funcToCall,
      millis,
      params,
      recurring,
      timeoutKey,
      runAtMillis
    ) {
      var f;
      if (typeof funcToCall === 'string') {
        /* jshint evil: true */
        f = function() {
          return eval(funcToCall);
        };
        /* jshint evil: false */
      } else {
        f = funcToCall;
      }

      millis = millis || 0;
      timeoutKey = timeoutKey || ++delayedFnCount;
      runAtMillis = runAtMillis || currentTime + millis;

      var funcToSchedule = {
        runAtMillis: runAtMillis,
        funcToCall: f,
        recurring: recurring,
        params: params,
        timeoutKey: timeoutKey,
        millis: millis
      };

      if (runAtMillis in scheduledFunctions) {
        scheduledFunctions[runAtMillis].push(funcToSchedule);
      } else {
        scheduledFunctions[runAtMillis] = [funcToSchedule];
        scheduledLookup.push(runAtMillis);
        scheduledLookup.sort(function(a, b) {
          return a - b;
        });
      }

      return timeoutKey;
    };

    self.removeFunctionWithId = function(timeoutKey) {
      deletedKeys.push(timeoutKey);

      for (var runAtMillis in scheduledFunctions) {
        var funcs = scheduledFunctions[runAtMillis];
        var i = indexOfFirstToPass(funcs, function(func) {
          return func.timeoutKey === timeoutKey;
        });

        if (i > -1) {
          if (funcs.length === 1) {
            delete scheduledFunctions[runAtMillis];
            deleteFromLookup(runAtMillis);
          } else {
            funcs.splice(i, 1);
          }

          // intervals get rescheduled when executed, so there's never more
          // than a single scheduled function with a given timeoutKey
          break;
        }
      }
    };

    return self;

    function indexOfFirstToPass(array, testFn) {
      var index = -1;

      for (var i = 0; i < array.length; ++i) {
        if (testFn(array[i])) {
          index = i;
          break;
        }
      }

      return index;
    }

    function deleteFromLookup(key) {
      var value = Number(key);
      var i = indexOfFirstToPass(scheduledLookup, function(millis) {
        return millis === value;
      });

      if (i > -1) {
        scheduledLookup.splice(i, 1);
      }
    }

    function reschedule(scheduledFn) {
      self.scheduleFunction(
        scheduledFn.funcToCall,
        scheduledFn.millis,
        scheduledFn.params,
        true,
        scheduledFn.timeoutKey,
        scheduledFn.runAtMillis + scheduledFn.millis
      );
    }

    function forEachFunction(funcsToRun, callback) {
      for (var i = 0; i < funcsToRun.length; ++i) {
        callback(funcsToRun[i]);
      }
    }

    function runScheduledFunctions(endTime, tickDate) {
      tickDate = tickDate || function() {};
      if (scheduledLookup.length === 0 || scheduledLookup[0] > endTime) {
        tickDate(endTime - currentTime);
        return;
      }

      do {
        deletedKeys = [];
        var newCurrentTime = scheduledLookup.shift();
        tickDate(newCurrentTime - currentTime);

        currentTime = newCurrentTime;

        var funcsToRun = scheduledFunctions[currentTime];

        delete scheduledFunctions[currentTime];

        forEachFunction(funcsToRun, function(funcToRun) {
          if (funcToRun.recurring) {
            reschedule(funcToRun);
          }
        });

        forEachFunction(funcsToRun, function(funcToRun) {
          if (j$.util.arrayContains(deletedKeys, funcToRun.timeoutKey)) {
            // skip a timeoutKey deleted whilst we were running
            return;
          }
          funcToRun.funcToCall.apply(null, funcToRun.params || []);
        });
        deletedKeys = [];
      } while (
        scheduledLookup.length > 0 &&
        // checking first if we're out of time prevents setTimeout(0)
        // scheduled in a funcToRun from forcing an extra iteration
        currentTime !== endTime &&
        scheduledLookup[0] <= endTime
      );

      // ran out of functions to call, but still time left on the clock
      if (currentTime !== endTime) {
        tickDate(endTime - currentTime);
      }
    }
  }

  return DelayedFunctionScheduler;
};

getJasmineRequireObj().errors = function() {
  function ExpectationFailed() {}

  ExpectationFailed.prototype = new Error();
  ExpectationFailed.prototype.constructor = ExpectationFailed;

  return {
    ExpectationFailed: ExpectationFailed
  };
};

getJasmineRequireObj().ExceptionFormatter = function(j$) {
  var ignoredProperties = [
    'name',
    'message',
    'stack',
    'fileName',
    'sourceURL',
    'line',
    'lineNumber',
    'column',
    'description',
    'jasmineMessage'
  ];

  function ExceptionFormatter(options) {
    var jasmineFile = (options && options.jasmineFile) || j$.util.jasmineFile();
    this.message = function(error) {
      var message = '';

      if (error.jasmineMessage) {
        message += error.jasmineMessage;
      } else if (error.name && error.message) {
        message += error.name + ': ' + error.message;
      } else if (error.message) {
        message += error.message;
      } else {
        message += error.toString() + ' thrown';
      }

      if (error.fileName || error.sourceURL) {
        message += ' in ' + (error.fileName || error.sourceURL);
      }

      if (error.line || error.lineNumber) {
        message += ' (line ' + (error.line || error.lineNumber) + ')';
      }

      return message;
    };

    this.stack = function(error) {
      if (!error || !error.stack) {
        return null;
      }

      var stackTrace = new j$.StackTrace(error);
      var lines = filterJasmine(stackTrace);
      var result = '';

      if (stackTrace.message) {
        lines.unshift(stackTrace.message);
      }

      result += formatProperties(error);
      result += lines.join('\n');

      return result;
    };

    function filterJasmine(stackTrace) {
      var result = [],
        jasmineMarker =
          stackTrace.style === 'webkit' ? '<Jasmine>' : '    at <Jasmine>';

      stackTrace.frames.forEach(function(frame) {
        if (frame.file && frame.file !== jasmineFile) {
          result.push(frame.raw);
        } else if (result[result.length - 1] !== jasmineMarker) {
          result.push(jasmineMarker);
        }
      });

      return result;
    }

    function formatProperties(error) {
      if (!(error instanceof Object)) {
        return;
      }

      var result = {};
      var empty = true;

      for (var prop in error) {
        if (j$.util.arrayContains(ignoredProperties, prop)) {
          continue;
        }
        result[prop] = error[prop];
        empty = false;
      }

      if (!empty) {
        return 'error properties: ' + j$.pp(result) + '\n';
      }

      return '';
    }
  }

  return ExceptionFormatter;
};

getJasmineRequireObj().Expectation = function(j$) {
  /**
   * Matchers that come with Jasmine out of the box.
   * @namespace matchers
   */
  function Expectation(options) {
    this.expector = new j$.Expector(options);

    var customMatchers = options.customMatchers || {};
    for (var matcherName in customMatchers) {
      this[matcherName] = wrapSyncCompare(
        matcherName,
        customMatchers[matcherName]
      );
    }
  }

  /**
   * Add some context for an {@link expect}
   * @function
   * @name matchers#withContext
   * @since 3.3.0
   * @param {String} message - Additional context to show when the matcher fails
   * @return {matchers}
   */
  Expectation.prototype.withContext = function withContext(message) {
    return addFilter(this, new ContextAddingFilter(message));
  };

  /**
   * Invert the matcher following this {@link expect}
   * @member
   * @name matchers#not
   * @since 1.3.0
   * @type {matchers}
   * @example
   * expect(something).not.toBe(true);
   */
  Object.defineProperty(Expectation.prototype, 'not', {
    get: function() {
      return addFilter(this, syncNegatingFilter);
    }
  });

  /**
   * Asynchronous matchers.
   * @namespace async-matchers
   */
  function AsyncExpectation(options) {
    var global = options.global || j$.getGlobal();
    this.expector = new j$.Expector(options);

    if (!global.Promise) {
      throw new Error(
        'expectAsync is unavailable because the environment does not support promises.'
      );
    }

    var customAsyncMatchers = options.customAsyncMatchers || {};
    for (var matcherName in customAsyncMatchers) {
      this[matcherName] = wrapAsyncCompare(
        matcherName,
        customAsyncMatchers[matcherName]
      );
    }
  }

  /**
   * Add some context for an {@link expectAsync}
   * @function
   * @name async-matchers#withContext
   * @since 3.3.0
   * @param {String} message - Additional context to show when the async matcher fails
   * @return {async-matchers}
   */
  AsyncExpectation.prototype.withContext = function withContext(message) {
    return addFilter(this, new ContextAddingFilter(message));
  };

  /**
   * Invert the matcher following this {@link expectAsync}
   * @member
   * @name async-matchers#not
   * @type {async-matchers}
   * @example
   * await expectAsync(myPromise).not.toBeResolved();
   * @example
   * return expectAsync(myPromise).not.toBeResolved();
   */
  Object.defineProperty(AsyncExpectation.prototype, 'not', {
    get: function() {
      return addFilter(this, asyncNegatingFilter);
    }
  });

  function wrapSyncCompare(name, matcherFactory) {
    return function() {
      var result = this.expector.compare(name, matcherFactory, arguments);
      this.expector.processResult(result);
    };
  }

  function wrapAsyncCompare(name, matcherFactory) {
    return function() {
      var self = this;

      // Capture the call stack here, before we go async, so that it will contain
      // frames that are relevant to the user instead of just parts of Jasmine.
      var errorForStack = j$.util.errorWithStack();

      return this.expector
        .compare(name, matcherFactory, arguments)
        .then(function(result) {
          self.expector.processResult(result, errorForStack);
        });
    };
  }

  function addCoreMatchers(prototype, matchers, wrapper) {
    for (var matcherName in matchers) {
      var matcher = matchers[matcherName];
      prototype[matcherName] = wrapper(matcherName, matcher);
    }
  }

  function addFilter(source, filter) {
    var result = Object.create(source);
    result.expector = source.expector.addFilter(filter);
    return result;
  }

  function negatedFailureMessage(result, matcherName, args, util) {
    if (result.message) {
      if (j$.isFunction_(result.message)) {
        return result.message();
      } else {
        return result.message;
      }
    }

    args = args.slice();
    args.unshift(true);
    args.unshift(matcherName);
    return util.buildFailureMessage.apply(null, args);
  }

  function negate(result) {
    result.pass = !result.pass;
    return result;
  }

  var syncNegatingFilter = {
    selectComparisonFunc: function(matcher) {
      function defaultNegativeCompare() {
        return negate(matcher.compare.apply(null, arguments));
      }

      return matcher.negativeCompare || defaultNegativeCompare;
    },
    buildFailureMessage: negatedFailureMessage
  };

  var asyncNegatingFilter = {
    selectComparisonFunc: function(matcher) {
      function defaultNegativeCompare() {
        return matcher.compare.apply(this, arguments).then(negate);
      }

      return matcher.negativeCompare || defaultNegativeCompare;
    },
    buildFailureMessage: negatedFailureMessage
  };

  function ContextAddingFilter(message) {
    this.message = message;
  }

  ContextAddingFilter.prototype.modifyFailureMessage = function(msg) {
    return this.message + ': ' + msg;
  };

  return {
    factory: function(options) {
      return new Expectation(options || {});
    },
    addCoreMatchers: function(matchers) {
      addCoreMatchers(Expectation.prototype, matchers, wrapSyncCompare);
    },
    asyncFactory: function(options) {
      return new AsyncExpectation(options || {});
    },
    addAsyncCoreMatchers: function(matchers) {
      addCoreMatchers(AsyncExpectation.prototype, matchers, wrapAsyncCompare);
    }
  };
};

getJasmineRequireObj().ExpectationFilterChain = function() {
  function ExpectationFilterChain(maybeFilter, prev) {
    this.filter_ = maybeFilter;
    this.prev_ = prev;
  }

  ExpectationFilterChain.prototype.addFilter = function(filter) {
    return new ExpectationFilterChain(filter, this);
  };

  ExpectationFilterChain.prototype.selectComparisonFunc = function(matcher) {
    return this.callFirst_('selectComparisonFunc', arguments).result;
  };

  ExpectationFilterChain.prototype.buildFailureMessage = function(
    result,
    matcherName,
    args,
    util
  ) {
    return this.callFirst_('buildFailureMessage', arguments).result;
  };

  ExpectationFilterChain.prototype.modifyFailureMessage = function(msg) {
    var result = this.callFirst_('modifyFailureMessage', arguments).result;
    return result || msg;
  };

  ExpectationFilterChain.prototype.callFirst_ = function(fname, args) {
    var prevResult;

    if (this.prev_) {
      prevResult = this.prev_.callFirst_(fname, args);

      if (prevResult.found) {
        return prevResult;
      }
    }

    if (this.filter_ && this.filter_[fname]) {
      return {
        found: true,
        result: this.filter_[fname].apply(this.filter_, args)
      };
    }

    return { found: false };
  };

  return ExpectationFilterChain;
};

//TODO: expectation result may make more sense as a presentation of an expectation.
getJasmineRequireObj().buildExpectationResult = function() {
  function buildExpectationResult(options) {
    var messageFormatter = options.messageFormatter || function() {},
      stackFormatter = options.stackFormatter || function() {};

    /**
     * @typedef Expectation
     * @property {String} matcherName - The name of the matcher that was executed for this expectation.
     * @property {String} message - The failure message for the expectation.
     * @property {String} stack - The stack trace for the failure if available.
     * @property {Boolean} passed - Whether the expectation passed or failed.
     * @property {Object} expected - If the expectation failed, what was the expected value.
     * @property {Object} actual - If the expectation failed, what actual value was produced.
     */
    var result = {
      matcherName: options.matcherName,
      message: message(),
      stack: stack(),
      passed: options.passed
    };

    if (!result.passed) {
      result.expected = options.expected;
      result.actual = options.actual;
    }

    return result;

    function message() {
      if (options.passed) {
        return 'Passed.';
      } else if (options.message) {
        return options.message;
      } else if (options.error) {
        return messageFormatter(options.error);
      }
      return '';
    }

    function stack() {
      if (options.passed) {
        return '';
      }

      var error = options.error;
      if (!error) {
        if (options.errorForStack) {
          error = options.errorForStack;
        } else if (options.stack) {
          error = options;
        } else {
          try {
            throw new Error(message());
          } catch (e) {
            error = e;
          }
        }
      }
      return stackFormatter(error);
    }
  }

  return buildExpectationResult;
};

getJasmineRequireObj().Expector = function(j$) {
  function Expector(options) {
    this.util = options.util || { buildFailureMessage: function() {} };
    this.customEqualityTesters = options.customEqualityTesters || [];
    this.actual = options.actual;
    this.addExpectationResult = options.addExpectationResult || function() {};
    this.filters = new j$.ExpectationFilterChain();
  }

  Expector.prototype.instantiateMatcher = function(
    matcherName,
    matcherFactory,
    args
  ) {
    this.matcherName = matcherName;
    this.args = Array.prototype.slice.call(args, 0);
    this.expected = this.args.slice(0);

    this.args.unshift(this.actual);

    var matcher = matcherFactory(this.util, this.customEqualityTesters);
    var comparisonFunc = this.filters.selectComparisonFunc(matcher);
    return comparisonFunc || matcher.compare;
  };

  Expector.prototype.buildMessage = function(result) {
    var self = this;

    if (result.pass) {
      return '';
    }

    var msg = this.filters.buildFailureMessage(
      result,
      this.matcherName,
      this.args,
      this.util,
      defaultMessage
    );
    return this.filters.modifyFailureMessage(msg || defaultMessage());

    function defaultMessage() {
      if (!result.message) {
        var args = self.args.slice();
        args.unshift(false);
        args.unshift(self.matcherName);
        return self.util.buildFailureMessage.apply(null, args);
      } else if (j$.isFunction_(result.message)) {
        return result.message();
      } else {
        return result.message;
      }
    }
  };

  Expector.prototype.compare = function(matcherName, matcherFactory, args) {
    var matcherCompare = this.instantiateMatcher(
      matcherName,
      matcherFactory,
      args
    );
    return matcherCompare.apply(null, this.args);
  };

  Expector.prototype.addFilter = function(filter) {
    var result = Object.create(this);
    result.filters = this.filters.addFilter(filter);
    return result;
  };

  Expector.prototype.processResult = function(result, errorForStack) {
    var message = this.buildMessage(result);

    if (this.expected.length === 1) {
      this.expected = this.expected[0];
    }

    this.addExpectationResult(result.pass, {
      matcherName: this.matcherName,
      passed: result.pass,
      message: message,
      error: errorForStack ? undefined : result.error,
      errorForStack: errorForStack || undefined,
      actual: this.actual,
      expected: this.expected // TODO: this may need to be arrayified/sliced
    });
  };

  return Expector;
};

getJasmineRequireObj().formatErrorMsg = function() {
  function generateErrorMsg(domain, usage) {
    var usageDefinition = usage ? '\nUsage: ' + usage : '';

    return function errorMsg(msg) {
      return domain + ' : ' + msg + usageDefinition;
    };
  }

  return generateErrorMsg;
};

getJasmineRequireObj().GlobalErrors = function(j$) {
  function GlobalErrors(global) {
    var handlers = [];
    global = global || j$.getGlobal();

    var onerror = function onerror() {
      var handler = handlers[handlers.length - 1];

      if (handler) {
        handler.apply(null, Array.prototype.slice.call(arguments, 0));
      } else {
        throw arguments[0];
      }
    };

    this.originalHandlers = {};
    this.jasmineHandlers = {};
    this.installOne_ = function installOne_(errorType, jasmineMessage) {
      function taggedOnError(error) {
        error.jasmineMessage = jasmineMessage + ': ' + error;

        var handler = handlers[handlers.length - 1];

        if (handler) {
          handler(error);
        } else {
          throw error;
        }
      }

      this.originalHandlers[errorType] = global.process.listeners(errorType);
      this.jasmineHandlers[errorType] = taggedOnError;

      global.process.removeAllListeners(errorType);
      global.process.on(errorType, taggedOnError);

      this.uninstall = function uninstall() {
        var errorTypes = Object.keys(this.originalHandlers);
        for (var iType = 0; iType < errorTypes.length; iType++) {
          var errorType = errorTypes[iType];
          global.process.removeListener(
            errorType,
            this.jasmineHandlers[errorType]
          );
          for (var i = 0; i < this.originalHandlers[errorType].length; i++) {
            global.process.on(errorType, this.originalHandlers[errorType][i]);
          }
          delete this.originalHandlers[errorType];
          delete this.jasmineHandlers[errorType];
        }
      };
    };

    this.install = function install() {
      if (
        global.process &&
        global.process.listeners &&
        j$.isFunction_(global.process.on)
      ) {
        this.installOne_('uncaughtException', 'Uncaught exception');
        this.installOne_('unhandledRejection', 'Unhandled promise rejection');
      } else {
        var originalHandler = global.onerror;
        global.onerror = onerror;

        this.uninstall = function uninstall() {
          global.onerror = originalHandler;
        };
      }
    };

    this.pushListener = function pushListener(listener) {
      handlers.push(listener);
    };

    this.popListener = function popListener() {
      handlers.pop();
    };
  }

  return GlobalErrors;
};

getJasmineRequireObj().toBeRejected = function(j$) {
  /**
   * Expect a promise to be rejected.
   * @function
   * @async
   * @name async-matchers#toBeRejected
   * @since 3.1.0
   * @example
   * await expectAsync(aPromise).toBeRejected();
   * @example
   * return expectAsync(aPromise).toBeRejected();
   */
  return function toBeRejected(util) {
    return {
      compare: function(actual) {
        if (!j$.isPromiseLike(actual)) {
          throw new Error('Expected toBeRejected to be called on a promise.');
        }
        return actual.then(
          function() { return {pass: false}; },
          function() { return {pass: true}; }
        );
      }
    };
  };
};

getJasmineRequireObj().toBeRejectedWith = function(j$) {
  /**
   * Expect a promise to be rejected with a value equal to the expected, using deep equality comparison.
   * @function
   * @async
   * @name async-matchers#toBeRejectedWith
   * @since 3.3.0
   * @param {Object} expected - Value that the promise is expected to be rejected with
   * @example
   * await expectAsync(aPromise).toBeRejectedWith({prop: 'value'});
   * @example
   * return expectAsync(aPromise).toBeRejectedWith({prop: 'value'});
   */
  return function toBeRejectedWith(util, customEqualityTesters) {
    return {
      compare: function(actualPromise, expectedValue) {
        if (!j$.isPromiseLike(actualPromise)) {
          throw new Error('Expected toBeRejectedWith to be called on a promise.');
        }

        function prefix(passed) {
          return 'Expected a promise ' +
            (passed ? 'not ' : '') +
            'to be rejected with ' + j$.pp(expectedValue);
        }

        return actualPromise.then(
          function() {
          return {
            pass: false,
            message: prefix(false) + ' but it was resolved.'
          };
        },
        function(actualValue) {
          if (util.equals(actualValue, expectedValue, customEqualityTesters)) {
            return {
              pass: true,
              message: prefix(true) + '.'
            };
          } else {
            return {
              pass: false,
              message: prefix(false) + ' but it was rejected with ' + j$.pp(actualValue) + '.'
            };
          }
        }
        );
      }
    };
  };
};

getJasmineRequireObj().toBeRejectedWithError = function(j$) {
  /**
   * Expect a promise to be rejected with a value matched to the expected
   * @function
   * @async
   * @name async-matchers#toBeRejectedWithError
   * @since 3.5.0
   * @param {Error} [expected] - `Error` constructor the object that was thrown needs to be an instance of. If not provided, `Error` will be used.
   * @param {RegExp|String} [message] - The message that should be set on the thrown `Error`
   * @example
   * await expectAsync(aPromise).toBeRejectedWithError(MyCustomError, 'Error message');
   * await expectAsync(aPromise).toBeRejectedWithError(MyCustomError, /Error message/);
   * await expectAsync(aPromise).toBeRejectedWithError(MyCustomError);
   * await expectAsync(aPromise).toBeRejectedWithError('Error message');
   * return expectAsync(aPromise).toBeRejectedWithError(/Error message/);
   */
  return function toBeRejectedWithError() {
    return {
      compare: function(actualPromise, arg1, arg2) {
        if (!j$.isPromiseLike(actualPromise)) {
          throw new Error('Expected toBeRejectedWithError to be called on a promise.');
        }

        var expected = getExpectedFromArgs(arg1, arg2);

        return actualPromise.then(
          function() {
            return {
              pass: false,
              message: 'Expected a promise to be rejected but it was resolved.'
            };
          },
          function(actualValue) { return matchError(actualValue, expected); }
        );
      }
    };
  };

  function matchError(actual, expected) {
    if (!j$.isError_(actual)) {
      return fail(expected, 'rejected with ' + j$.pp(actual));
    }

    if (!(actual instanceof expected.error)) {
      return fail(expected, 'rejected with type ' + j$.fnNameFor(actual.constructor));
    }

    var actualMessage = actual.message;

    if (actualMessage === expected.message || typeof expected.message === 'undefined') {
      return pass(expected);
    }

    if (expected.message instanceof RegExp && expected.message.test(actualMessage)) {
      return pass(expected);
    }

    return fail(expected, 'rejected with ' + j$.pp(actual));
  }

  function pass(expected) {
    return {
      pass: true,
      message: 'Expected a promise not to be rejected with ' + expected.printValue + ', but it was.'
    };
  }

  function fail(expected, message) {
    return {
      pass: false,
      message: 'Expected a promise to be rejected with ' + expected.printValue + ' but it was ' + message + '.'
    };
  }


  function getExpectedFromArgs(arg1, arg2) {
    var error, message;

    if (isErrorConstructor(arg1)) {
      error = arg1;
      message = arg2;
    } else {
      error = Error;
      message = arg1;
    }

    return {
      error: error,
      message: message,
      printValue: j$.fnNameFor(error) + (typeof message === 'undefined' ? '' : ': ' + j$.pp(message))
    };
  }

  function isErrorConstructor(value) {
    return typeof value === 'function' && (value === Error || j$.isError_(value.prototype));
  }
};

getJasmineRequireObj().toBeResolved = function(j$) {
  /**
   * Expect a promise to be resolved.
   * @function
   * @async
   * @name async-matchers#toBeResolved
   * @since 3.1.0
   * @example
   * await expectAsync(aPromise).toBeResolved();
   * @example
   * return expectAsync(aPromise).toBeResolved();
   */
  return function toBeResolved(util) {
    return {
      compare: function(actual) {
        if (!j$.isPromiseLike(actual)) {
          throw new Error('Expected toBeResolved to be called on a promise.');
        }

        return actual.then(
          function() { return {pass: true}; },
          function() { return {pass: false}; }
        );
      }
    };
  };
};

getJasmineRequireObj().toBeResolvedTo = function(j$) {
  /**
   * Expect a promise to be resolved to a value equal to the expected, using deep equality comparison.
   * @function
   * @async
   * @name async-matchers#toBeResolvedTo
   * @since 3.1.0
   * @param {Object} expected - Value that the promise is expected to resolve to
   * @example
   * await expectAsync(aPromise).toBeResolvedTo({prop: 'value'});
   * @example
   * return expectAsync(aPromise).toBeResolvedTo({prop: 'value'});
   */
  return function toBeResolvedTo(util, customEqualityTesters) {
    return {
      compare: function(actualPromise, expectedValue) {
        if (!j$.isPromiseLike(actualPromise)) {
          throw new Error('Expected toBeResolvedTo to be called on a promise.');
        }

        function prefix(passed) {
          return 'Expected a promise ' +
            (passed ? 'not ' : '') +
            'to be resolved to ' + j$.pp(expectedValue);
        }

        return actualPromise.then(
          function(actualValue) {
            if (util.equals(actualValue, expectedValue, customEqualityTesters)) {
              return {
                pass: true,
                message: prefix(true) + '.'
              };
            } else {
              return {
                pass: false,
                message: prefix(false) + ' but it was resolved to ' + j$.pp(actualValue) + '.'
              };
            }
          },
          function() {
            return {
              pass: false,
              message: prefix(false) + ' but it was rejected.'
            };
          }
        );
      }
    };
  };
};

getJasmineRequireObj().DiffBuilder = function(j$) {
  return function DiffBuilder() {
    var path = new j$.ObjectPath(),
        mismatches = [];

    return {
      record: function (actual, expected, formatter) {
        formatter = formatter || defaultFormatter;
        mismatches.push(formatter(actual, expected, path));
      },

      getMessage: function () {
        return mismatches.join('\n');
      },

      withPath: function (pathComponent, block) {
        var oldPath = path;
        path = path.add(pathComponent);
        block();
        path = oldPath;
      }
    };

    function defaultFormatter (actual, expected, path) {
      return 'Expected ' +
        path + (path.depth() ? ' = ' : '') +
        j$.pp(actual) +
        ' to equal ' +
        j$.pp(expected) +
        '.';
    }
  };
};

getJasmineRequireObj().matchersUtil = function(j$) {
  // TODO: what to do about jasmine.pp not being inject? move to JSON.stringify? gut PrettyPrinter?

  return {
    equals: equals,

    contains: function(haystack, needle, customTesters) {
      customTesters = customTesters || [];

      if (j$.isSet(haystack)) {
        return haystack.has(needle);
      }

      if ((Object.prototype.toString.apply(haystack) === '[object Array]') ||
        (!!haystack && !haystack.indexOf))
      {
        for (var i = 0; i < haystack.length; i++) {
          if (equals(haystack[i], needle, customTesters)) {
            return true;
          }
        }
        return false;
      }

      return !!haystack && haystack.indexOf(needle) >= 0;
    },

    buildFailureMessage: function() {
      var args = Array.prototype.slice.call(arguments, 0),
        matcherName = args[0],
        isNot = args[1],
        actual = args[2],
        expected = args.slice(3),
        englishyPredicate = matcherName.replace(/[A-Z]/g, function(s) { return ' ' + s.toLowerCase(); });

      var message = 'Expected ' +
        j$.pp(actual) +
        (isNot ? ' not ' : ' ') +
        englishyPredicate;

      if (expected.length > 0) {
        for (var i = 0; i < expected.length; i++) {
          if (i > 0) {
            message += ',';
          }
          message += ' ' + j$.pp(expected[i]);
        }
      }

      return message + '.';
    }
  };

  function isAsymmetric(obj) {
    return obj && j$.isA_('Function', obj.asymmetricMatch);
  }

  function asymmetricMatch(a, b, customTesters, diffBuilder) {
    var asymmetricA = isAsymmetric(a),
        asymmetricB = isAsymmetric(b),
        result;

    if (asymmetricA && asymmetricB) {
      return undefined;
    }

    if (asymmetricA) {
      result = a.asymmetricMatch(b, customTesters);
      if (!result) {
        diffBuilder.record(a, b);
      }
      return result;
    }

    if (asymmetricB) {
      result = b.asymmetricMatch(a, customTesters);
      if (!result) {
        diffBuilder.record(a, b);
      }
      return result;
    }
  }

  function equals(a, b, customTesters, diffBuilder) {
    customTesters = customTesters || [];
    diffBuilder = diffBuilder || j$.NullDiffBuilder();

    return eq(a, b, [], [], customTesters, diffBuilder);
  }

  // Equality function lovingly adapted from isEqual in
  //   [Underscore](http://underscorejs.org)
  function eq(a, b, aStack, bStack, customTesters, diffBuilder) {
    var result = true, i;

    var asymmetricResult = asymmetricMatch(a, b, customTesters, diffBuilder);
    if (!j$.util.isUndefined(asymmetricResult)) {
      return asymmetricResult;
    }

    for (i = 0; i < customTesters.length; i++) {
      var customTesterResult = customTesters[i](a, b);
      if (!j$.util.isUndefined(customTesterResult)) {
        if (!customTesterResult) {
          diffBuilder.record(a, b);
        }
        return customTesterResult;
      }
    }

    if (a instanceof Error && b instanceof Error) {
      result = a.message == b.message;
      if (!result) {
        diffBuilder.record(a, b);
      }
      return result;
    }

    // Identical objects are equal. `0 === -0`, but they aren't identical.
    // See the [Harmony `egal` proposal](http://wiki.ecmascript.org/doku.php?id=harmony:egal).
    if (a === b) {
      result = a !== 0 || 1 / a == 1 / b;
      if (!result) {
        diffBuilder.record(a, b);
      }
      return result;
    }
    // A strict comparison is necessary because `null == undefined`.
    if (a === null || b === null) {
      result = a === b;
      if (!result) {
        diffBuilder.record(a, b);
      }
      return result;
    }
    var className = Object.prototype.toString.call(a);
    if (className != Object.prototype.toString.call(b)) {
      diffBuilder.record(a, b);
      return false;
    }
    switch (className) {
      // Strings, numbers, dates, and booleans are compared by value.
      case '[object String]':
        // Primitives and their corresponding object wrappers are equivalent; thus, `"5"` is
        // equivalent to `new String("5")`.
        result = a == String(b);
        if (!result) {
          diffBuilder.record(a, b);
        }
        return result;
      case '[object Number]':
        // `NaN`s are equivalent, but non-reflexive. An `egal` comparison is performed for
        // other numeric values.
        result = a != +a ? b != +b : (a === 0 ? 1 / a == 1 / b : a == +b);
        if (!result) {
          diffBuilder.record(a, b);
        }
        return result;
      case '[object Date]':
      case '[object Boolean]':
        // Coerce dates and booleans to numeric primitive values. Dates are compared by their
        // millisecond representations. Note that invalid dates with millisecond representations
        // of `NaN` are not equivalent.
        result = +a == +b;
        if (!result) {
          diffBuilder.record(a, b);
        }
        return result;
      // RegExps are compared by their source patterns and flags.
      case '[object RegExp]':
        return a.source == b.source &&
          a.global == b.global &&
          a.multiline == b.multiline &&
          a.ignoreCase == b.ignoreCase;
    }
    if (typeof a != 'object' || typeof b != 'object') {
      diffBuilder.record(a, b);
      return false;
    }

    var aIsDomNode = j$.isDomNode(a);
    var bIsDomNode = j$.isDomNode(b);
    if (aIsDomNode && bIsDomNode) {
      // At first try to use DOM3 method isEqualNode
      result = a.isEqualNode(b);
      if (!result) {
        diffBuilder.record(a, b);
      }
      return result;
    }
    if (aIsDomNode || bIsDomNode) {
      diffBuilder.record(a, b);
      return false;
    }

    var aIsPromise = j$.isPromise(a);
    var bIsPromise = j$.isPromise(b);
    if (aIsPromise && bIsPromise) {
      return a === b;
    }

    // Assume equality for cyclic structures. The algorithm for detecting cyclic
    // structures is adapted from ES 5.1 section 15.12.3, abstract operation `JO`.
    var length = aStack.length;
    while (length--) {
      // Linear search. Performance is inversely proportional to the number of
      // unique nested structures.
      if (aStack[length] == a) { return bStack[length] == b; }
    }
    // Add the first object to the stack of traversed objects.
    aStack.push(a);
    bStack.push(b);
    var size = 0;
    // Recursively compare objects and arrays.
    // Compare array lengths to determine if a deep comparison is necessary.
    if (className == '[object Array]') {
      var aLength = a.length;
      var bLength = b.length;

      diffBuilder.withPath('length', function() {
        if (aLength !== bLength) {
          diffBuilder.record(aLength, bLength);
          result = false;
        }
      });

      for (i = 0; i < aLength || i < bLength; i++) {
        diffBuilder.withPath(i, function() {
          if (i >= bLength) {
            diffBuilder.record(a[i], void 0, actualArrayIsLongerFormatter);
            result = false;
          } else {
            result = eq(i < aLength ? a[i] : void 0, i < bLength ? b[i] : void 0, aStack, bStack, customTesters, diffBuilder) && result;
          }
        });
      }
      if (!result) {
        return false;
      }
    } else if (j$.isMap(a) && j$.isMap(b)) {
      if (a.size != b.size) {
        diffBuilder.record(a, b);
        return false;
      }

      var keysA = [];
      var keysB = [];
      a.forEach( function( valueA, keyA ) {
        keysA.push( keyA );
      });
      b.forEach( function( valueB, keyB ) {
        keysB.push( keyB );
      });

      // For both sets of keys, check they map to equal values in both maps.
      // Keep track of corresponding keys (in insertion order) in order to handle asymmetric obj keys.
      var mapKeys = [keysA, keysB];
      var cmpKeys = [keysB, keysA];
      var mapIter, mapKey, mapValueA, mapValueB;
      var cmpIter, cmpKey;
      for (i = 0; result && i < mapKeys.length; i++) {
        mapIter = mapKeys[i];
        cmpIter = cmpKeys[i];

        for (var j = 0; result && j < mapIter.length; j++) {
          mapKey = mapIter[j];
          cmpKey = cmpIter[j];
          mapValueA = a.get(mapKey);

          // Only use the cmpKey when one of the keys is asymmetric and the corresponding key matches,
          // otherwise explicitly look up the mapKey in the other Map since we want keys with unique
          // obj identity (that are otherwise equal) to not match.
          if (isAsymmetric(mapKey) || isAsymmetric(cmpKey) &&
              eq(mapKey, cmpKey, aStack, bStack, customTesters, j$.NullDiffBuilder())) {
            mapValueB = b.get(cmpKey);
          } else {
            mapValueB = b.get(mapKey);
          }
          result = eq(mapValueA, mapValueB, aStack, bStack, customTesters, j$.NullDiffBuilder());
        }
      }

      if (!result) {
        diffBuilder.record(a, b);
        return false;
      }
    } else if (j$.isSet(a) && j$.isSet(b)) {
      if (a.size != b.size) {
        diffBuilder.record(a, b);
        return false;
      }

      var valuesA = [];
      a.forEach( function( valueA ) {
        valuesA.push( valueA );
      });
      var valuesB = [];
      b.forEach( function( valueB ) {
        valuesB.push( valueB );
      });

      // For both sets, check they are all contained in the other set
      var setPairs = [[valuesA, valuesB], [valuesB, valuesA]];
      var stackPairs = [[aStack, bStack], [bStack, aStack]];
      var baseValues, baseValue, baseStack;
      var otherValues, otherValue, otherStack;
      var found;
      var prevStackSize;
      for (i = 0; result && i < setPairs.length; i++) {
        baseValues = setPairs[i][0];
        otherValues = setPairs[i][1];
        baseStack = stackPairs[i][0];
        otherStack = stackPairs[i][1];
        // For each value in the base set...
        for (var k = 0; result && k < baseValues.length; k++) {
          baseValue = baseValues[k];
          found = false;
          // ... test that it is present in the other set
          for (var l = 0; !found && l < otherValues.length; l++) {
            otherValue = otherValues[l];
            prevStackSize = baseStack.length;
            // compare by value equality
            found = eq(baseValue, otherValue, baseStack, otherStack, customTesters, j$.NullDiffBuilder());
            if (!found && prevStackSize !== baseStack.length) {
              baseStack.splice(prevStackSize);
              otherStack.splice(prevStackSize);
            }
          }
          result = result && found;
        }
      }

      if (!result) {
        diffBuilder.record(a, b);
        return false;
      }
    } else {

      // Objects with different constructors are not equivalent, but `Object`s
      // or `Array`s from different frames are.
      var aCtor = a.constructor, bCtor = b.constructor;
      if (aCtor !== bCtor &&
          isFunction(aCtor) && isFunction(bCtor) &&
          a instanceof aCtor && b instanceof bCtor &&
          !(aCtor instanceof aCtor && bCtor instanceof bCtor)) {

        diffBuilder.record(a, b, constructorsAreDifferentFormatter);
        return false;
      }
    }

    // Deep compare objects.
    var aKeys = keys(a, className == '[object Array]'), key;
    size = aKeys.length;

    // Ensure that both objects contain the same number of properties before comparing deep equality.
    if (keys(b, className == '[object Array]').length !== size) {
      diffBuilder.record(a, b, objectKeysAreDifferentFormatter);
      return false;
    }

    for (i = 0; i < size; i++) {
      key = aKeys[i];
      // Deep compare each member
      if (!j$.util.has(b, key)) {
        diffBuilder.record(a, b, objectKeysAreDifferentFormatter);
        result = false;
        continue;
      }

      diffBuilder.withPath(key, function() {
        if(!eq(a[key], b[key], aStack, bStack, customTesters, diffBuilder)) {
          result = false;
        }
      });
    }

    if (!result) {
      return false;
    }

    // Remove the first object from the stack of traversed objects.
    aStack.pop();
    bStack.pop();

    return result;
  }

  function keys(obj, isArray) {
    var allKeys = Object.keys ? Object.keys(obj) :
      (function(o) {
          var keys = [];
          for (var key in o) {
              if (j$.util.has(o, key)) {
                  keys.push(key);
              }
          }
          return keys;
      })(obj);

    if (!isArray) {
      return allKeys;
    }

    if (allKeys.length === 0) {
        return allKeys;
    }

    var extraKeys = [];
    for (var i = 0; i < allKeys.length; i++) {
      if (!/^[0-9]+$/.test(allKeys[i])) {
        extraKeys.push(allKeys[i]);
      }
    }

    return extraKeys;
  }

  function isFunction(obj) {
    return typeof obj === 'function';
  }

  function objectKeysAreDifferentFormatter(actual, expected, path) {
    var missingProperties = j$.util.objectDifference(expected, actual),
        extraProperties = j$.util.objectDifference(actual, expected),
        missingPropertiesMessage = formatKeyValuePairs(missingProperties),
        extraPropertiesMessage = formatKeyValuePairs(extraProperties),
        messages = [];

    if (!path.depth()) {
      path = 'object';
    }

    if (missingPropertiesMessage.length) {
      messages.push('Expected ' + path + ' to have properties' + missingPropertiesMessage);
    }

    if (extraPropertiesMessage.length) {
      messages.push('Expected ' + path + ' not to have properties' + extraPropertiesMessage);
    }

    return messages.join('\n');
  }

  function constructorsAreDifferentFormatter(actual, expected, path) {
    if (!path.depth()) {
      path = 'object';
    }

    return 'Expected ' +
      path + ' to be a kind of ' +
      j$.fnNameFor(expected.constructor) +
      ', but was ' + j$.pp(actual) + '.';
  }

  function actualArrayIsLongerFormatter(actual, expected, path) {
    return 'Unexpected ' +
      path + (path.depth() ? ' = ' : '') +
      j$.pp(actual) +
      ' in array.';
  }

  function formatKeyValuePairs(obj) {
    var formatted = '';
    for (var key in obj) {
      formatted += '\n    ' + key + ': ' + j$.pp(obj[key]);
    }
    return formatted;
  }
};

getJasmineRequireObj().nothing = function() {
  /**
   * {@link expect} nothing explicitly.
   * @function
   * @name matchers#nothing
   * @since 2.8.0
   * @example
   * expect().nothing();
   */
  function nothing() {
    return {
      compare: function() {
        return {
          pass: true
        };
      }
    };
  }

  return nothing;
};

getJasmineRequireObj().NullDiffBuilder = function(j$) {
  return function() {
    return {
      withPath: function(_, block) {
        block();
      },
      record: function() {}
    };
  };
};

getJasmineRequireObj().ObjectPath = function(j$) {
  function ObjectPath(components) {
    this.components = components || [];
  }

  ObjectPath.prototype.toString = function() {
    if (this.components.length) {
      return '$' + map(this.components, formatPropertyAccess).join('');
    } else {
      return '';
    }
  };

  ObjectPath.prototype.add = function(component) {
    return new ObjectPath(this.components.concat([component]));
  };

  ObjectPath.prototype.depth = function() {
    return this.components.length;
  };

  function formatPropertyAccess(prop) {
    if (typeof prop === 'number') {
      return '[' + prop + ']';
    }

    if (isValidIdentifier(prop)) {
      return '.' + prop;
    }

    return '[\'' + prop + '\']';
  }

  function map(array, fn) {
    var results = [];
    for (var i = 0; i < array.length; i++) {
      results.push(fn(array[i]));
    }
    return results;
  }

  function isValidIdentifier(string) {
    return /^[A-Za-z\$_][A-Za-z0-9\$_]*$/.test(string);
  }

  return ObjectPath;
};

getJasmineRequireObj().requireAsyncMatchers = function(jRequire, j$) {
  var availableMatchers = [
      'toBeResolved',
      'toBeRejected',
      'toBeResolvedTo',
      'toBeRejectedWith',
      'toBeRejectedWithError'
    ],
    matchers = {};

  for (var i = 0; i < availableMatchers.length; i++) {
    var name = availableMatchers[i];
    matchers[name] = jRequire[name](j$);
  }

  return matchers;
};

getJasmineRequireObj().toBe = function(j$) {
  /**
   * {@link expect} the actual value to be `===` to the expected value.
   * @function
   * @name matchers#toBe
   * @since 1.3.0
   * @param {Object} expected - The expected value to compare against.
   * @example
   * expect(thing).toBe(realThing);
   */
  function toBe(util) {
    var tip = ' Tip: To check for deep equality, use .toEqual() instead of .toBe().';

    return {
      compare: function(actual, expected) {
        var result = {
          pass: actual === expected
        };

        if (typeof expected === 'object') {
          result.message = util.buildFailureMessage('toBe', result.pass, actual, expected) + tip;
        }

        return result;
      }
    };
  }

  return toBe;
};

getJasmineRequireObj().toBeCloseTo = function() {
  /**
   * {@link expect} the actual value to be within a specified precision of the expected value.
   * @function
   * @name matchers#toBeCloseTo
   * @since 1.3.0
   * @param {Object} expected - The expected value to compare against.
   * @param {Number} [precision=2] - The number of decimal points to check.
   * @example
   * expect(number).toBeCloseTo(42.2, 3);
   */
  function toBeCloseTo() {
    return {
      compare: function(actual, expected, precision) {
        if (precision !== 0) {
          precision = precision || 2;
        }

        if (expected === null || actual === null) {
          throw new Error('Cannot use toBeCloseTo with null. Arguments evaluated to: ' +
            'expect(' + actual + ').toBeCloseTo(' + expected + ').'
          );
        }

        var pow = Math.pow(10, precision + 1);
        var delta = Math.abs(expected - actual);
        var maxDelta = Math.pow(10, -precision) / 2;

        return {
          pass: Math.round(delta * pow) <= maxDelta * pow
        };
      }
    };
  }

  return toBeCloseTo;
};

getJasmineRequireObj().toBeDefined = function() {
  /**
   * {@link expect} the actual value to be defined. (Not `undefined`)
   * @function
   * @name matchers#toBeDefined
   * @since 1.3.0
   * @example
   * expect(result).toBeDefined();
   */
  function toBeDefined() {
    return {
      compare: function(actual) {
        return {
          pass: (void 0 !== actual)
        };
      }
    };
  }

  return toBeDefined;
};

getJasmineRequireObj().toBeFalse = function() {
  /**
   * {@link expect} the actual value to be `false`.
   * @function
   * @name matchers#toBeFalse
   * @since 3.5.0
   * @example
   * expect(result).toBeFalse();
   */
  function toBeFalse() {
    return {
      compare: function(actual) {
        return {
          pass: actual === false
        };
      }
    };
  }

  return toBeFalse;
};

getJasmineRequireObj().toBeFalsy = function() {
  /**
   * {@link expect} the actual value to be falsy
   * @function
   * @name matchers#toBeFalsy
   * @since 2.0.0
   * @example
   * expect(result).toBeFalsy();
   */
  function toBeFalsy() {
    return {
      compare: function(actual) {
        return {
          pass: !actual
        };
      }
    };
  }

  return toBeFalsy;
};

getJasmineRequireObj().toBeGreaterThan = function() {
  /**
   * {@link expect} the actual value to be greater than the expected value.
   * @function
   * @name matchers#toBeGreaterThan
   * @since 2.0.0
   * @param {Number} expected - The value to compare against.
   * @example
   * expect(result).toBeGreaterThan(3);
   */
  function toBeGreaterThan() {
    return {
      compare: function(actual, expected) {
        return {
          pass: actual > expected
        };
      }
    };
  }

  return toBeGreaterThan;
};


getJasmineRequireObj().toBeGreaterThanOrEqual = function() {
  /**
   * {@link expect} the actual value to be greater than or equal to the expected value.
   * @function
   * @name matchers#toBeGreaterThanOrEqual
   * @since 2.0.0
   * @param {Number} expected - The expected value to compare against.
   * @example
   * expect(result).toBeGreaterThanOrEqual(25);
   */
  function toBeGreaterThanOrEqual() {
    return {
      compare: function(actual, expected) {
        return {
          pass: actual >= expected
        };
      }
    };
  }

  return toBeGreaterThanOrEqual;
};

getJasmineRequireObj().toBeInstanceOf = function(j$) {
  var usageError =  j$.formatErrorMsg('<toBeInstanceOf>', 'expect(value).toBeInstanceOf(<ConstructorFunction>)');

  /**
   * {@link expect} the actual to be an instance of the expected class
   * @function
   * @name matchers#toBeInstanceOf
   * @since 3.5.0
   * @param {Object} expected - The class or constructor function to check for
   * @example
   * expect('foo').toBeInstanceOf(String);
   * expect(3).toBeInstanceOf(Number);
   * expect(new Error()).toBeInstanceOf(Error);
   */
  function toBeInstanceOf(util, customEqualityTesters) {
    return {
      compare: function(actual, expected) {
        var actualType = actual && actual.constructor ? j$.fnNameFor(actual.constructor) : j$.pp(actual),
            expectedType = expected ? j$.fnNameFor(expected) : j$.pp(expected),
            expectedMatcher,
            pass;

        try {
            expectedMatcher = new j$.Any(expected);
            pass = expectedMatcher.asymmetricMatch(actual);
        } catch (error) {
            throw new Error(usageError('Expected value is not a constructor function'));
        }

        if (pass) {
          return {
            pass: true,
            message: 'Expected instance of ' + actualType + ' not to be an instance of ' + expectedType
          };
        } else {
          return {
            pass: false,
            message: 'Expected instance of ' + actualType + ' to be an instance of ' + expectedType
          };
        }
      }
    };
  }

  return toBeInstanceOf;
};

getJasmineRequireObj().toBeLessThan = function() {
  /**
   * {@link expect} the actual value to be less than the expected value.
   * @function
   * @name matchers#toBeLessThan
   * @since 2.0.0
   * @param {Number} expected - The expected value to compare against.
   * @example
   * expect(result).toBeLessThan(0);
   */
  function toBeLessThan() {
    return {

      compare: function(actual, expected) {
        return {
          pass: actual < expected
        };
      }
    };
  }

  return toBeLessThan;
};

getJasmineRequireObj().toBeLessThanOrEqual = function() {
  /**
   * {@link expect} the actual value to be less than or equal to the expected value.
   * @function
   * @name matchers#toBeLessThanOrEqual
   * @since 2.0.0
   * @param {Number} expected - The expected value to compare against.
   * @example
   * expect(result).toBeLessThanOrEqual(123);
   */
  function toBeLessThanOrEqual() {
    return {

      compare: function(actual, expected) {
        return {
          pass: actual <= expected
        };
      }
    };
  }

  return toBeLessThanOrEqual;
};

getJasmineRequireObj().toBeNaN = function(j$) {
  /**
   * {@link expect} the actual value to be `NaN` (Not a Number).
   * @function
   * @name matchers#toBeNaN
   * @since 1.3.0
   * @example
   * expect(thing).toBeNaN();
   */
  function toBeNaN() {
    return {
      compare: function(actual) {
        var result = {
          pass: (actual !== actual)
        };

        if (result.pass) {
          result.message = 'Expected actual not to be NaN.';
        } else {
          result.message = function() { return 'Expected ' + j$.pp(actual) + ' to be NaN.'; };
        }

        return result;
      }
    };
  }

  return toBeNaN;
};

getJasmineRequireObj().toBeNegativeInfinity = function(j$) {
  /**
   * {@link expect} the actual value to be `-Infinity` (-infinity).
   * @function
   * @name matchers#toBeNegativeInfinity
   * @since 2.6.0
   * @example
   * expect(thing).toBeNegativeInfinity();
   */
  function toBeNegativeInfinity() {
    return {
      compare: function(actual) {
        var result = {
          pass: (actual === Number.NEGATIVE_INFINITY)
        };

        if (result.pass) {
          result.message = 'Expected actual not to be -Infinity.';
        } else {
          result.message = function() { return 'Expected ' + j$.pp(actual) + ' to be -Infinity.'; };
        }

        return result;
      }
    };
  }

  return toBeNegativeInfinity;
};

getJasmineRequireObj().toBeNull = function() {
  /**
   * {@link expect} the actual value to be `null`.
   * @function
   * @name matchers#toBeNull
   * @since 1.3.0
   * @example
   * expect(result).toBeNull();
   */
  function toBeNull() {
    return {
      compare: function(actual) {
        return {
          pass: actual === null
        };
      }
    };
  }

  return toBeNull;
};

getJasmineRequireObj().toBePositiveInfinity = function(j$) {
  /**
   * {@link expect} the actual value to be `Infinity` (infinity).
   * @function
   * @name matchers#toBePositiveInfinity
   * @since 2.6.0
   * @example
   * expect(thing).toBePositiveInfinity();
   */
  function toBePositiveInfinity() {
    return {
      compare: function(actual) {
        var result = {
          pass: (actual === Number.POSITIVE_INFINITY)
        };

        if (result.pass) {
          result.message = 'Expected actual not to be Infinity.';
        } else {
          result.message = function() { return 'Expected ' + j$.pp(actual) + ' to be Infinity.'; };
        }

        return result;
      }
    };
  }

  return toBePositiveInfinity;
};

getJasmineRequireObj().toBeTrue = function() {
  /**
   * {@link expect} the actual value to be `true`.
   * @function
   * @name matchers#toBeTrue
   * @since 3.5.0
   * @example
   * expect(result).toBeTrue();
   */
  function toBeTrue() {
    return {
      compare: function(actual) {
        return {
          pass: actual === true
        };
      }
    };
  }

  return toBeTrue;
};

getJasmineRequireObj().toBeTruthy = function() {
  /**
   * {@link expect} the actual value to be truthy.
   * @function
   * @name matchers#toBeTruthy
   * @since 2.0.0
   * @example
   * expect(thing).toBeTruthy();
   */
  function toBeTruthy() {
    return {
      compare: function(actual) {
        return {
          pass: !!actual
        };
      }
    };
  }

  return toBeTruthy;
};

getJasmineRequireObj().toBeUndefined = function() {
  /**
   * {@link expect} the actual value to be `undefined`.
   * @function
   * @name matchers#toBeUndefined
   * @since 1.3.0
   * @example
   * expect(result).toBeUndefined():
   */
  function toBeUndefined() {
    return {
      compare: function(actual) {
        return {
          pass: void 0 === actual
        };
      }
    };
  }

  return toBeUndefined;
};

getJasmineRequireObj().toContain = function() {
  /**
   * {@link expect} the actual value to contain a specific value.
   * @function
   * @name matchers#toContain
   * @since 2.0.0
   * @param {Object} expected - The value to look for.
   * @example
   * expect(array).toContain(anElement);
   * expect(string).toContain(substring);
   */
  function toContain(util, customEqualityTesters) {
    customEqualityTesters = customEqualityTesters || [];

    return {
      compare: function(actual, expected) {

        return {
          pass: util.contains(actual, expected, customEqualityTesters)
        };
      }
    };
  }

  return toContain;
};

getJasmineRequireObj().toEqual = function(j$) {
  /**
   * {@link expect} the actual value to be equal to the expected, using deep equality comparison.
   * @function
   * @name matchers#toEqual
   * @since 1.3.0
   * @param {Object} expected - Expected value
   * @example
   * expect(bigObject).toEqual({"foo": ['bar', 'baz']});
   */
  function toEqual(util, customEqualityTesters) {
    customEqualityTesters = customEqualityTesters || [];

    return {
      compare: function(actual, expected) {
        var result = {
            pass: false
          },
          diffBuilder = j$.DiffBuilder();

        result.pass = util.equals(actual, expected, customEqualityTesters, diffBuilder);

        // TODO: only set error message if test fails
        result.message = diffBuilder.getMessage();

        return result;
      }
    };
  }

  return toEqual;
};

getJasmineRequireObj().toHaveBeenCalled = function(j$) {

  var getErrorMsg = j$.formatErrorMsg('<toHaveBeenCalled>', 'expect(<spyObj>).toHaveBeenCalled()');

  /**
   * {@link expect} the actual (a {@link Spy}) to have been called.
   * @function
   * @name matchers#toHaveBeenCalled
   * @since 1.3.0
   * @example
   * expect(mySpy).toHaveBeenCalled();
   * expect(mySpy).not.toHaveBeenCalled();
   */
  function toHaveBeenCalled() {
    return {
      compare: function(actual) {
        var result = {};

        if (!j$.isSpy(actual)) {
          throw new Error(getErrorMsg('Expected a spy, but got ' + j$.pp(actual) + '.'));
        }

        if (arguments.length > 1) {
          throw new Error(getErrorMsg('Does not take arguments, use toHaveBeenCalledWith'));
        }

        result.pass = actual.calls.any();

        result.message = result.pass ?
          'Expected spy ' + actual.and.identity + ' not to have been called.' :
          'Expected spy ' + actual.and.identity + ' to have been called.';

        return result;
      }
    };
  }

  return toHaveBeenCalled;
};

getJasmineRequireObj().toHaveBeenCalledBefore = function(j$) {

  var getErrorMsg = j$.formatErrorMsg('<toHaveBeenCalledBefore>', 'expect(<spyObj>).toHaveBeenCalledBefore(<spyObj>)');

  /**
   * {@link expect} the actual value (a {@link Spy}) to have been called before another {@link Spy}.
   * @function
   * @name matchers#toHaveBeenCalledBefore
   * @since 2.6.0
   * @param {Spy} expected - {@link Spy} that should have been called after the `actual` {@link Spy}.
   * @example
   * expect(mySpy).toHaveBeenCalledBefore(otherSpy);
   */
  function toHaveBeenCalledBefore() {
    return {
      compare: function(firstSpy, latterSpy) {
        if (!j$.isSpy(firstSpy)) {
          throw new Error(getErrorMsg('Expected a spy, but got ' + j$.pp(firstSpy) + '.'));
        }
        if (!j$.isSpy(latterSpy)) {
          throw new Error(getErrorMsg('Expected a spy, but got ' + j$.pp(latterSpy) + '.'));
        }

        var result = { pass: false };

        if (!firstSpy.calls.count()) {
          result.message = 'Expected spy ' +  firstSpy.and.identity + ' to have been called.';
          return result;
        }
        if (!latterSpy.calls.count()) {
          result.message = 'Expected spy ' +  latterSpy.and.identity + ' to have been called.';
          return result;
        }

        var latest1stSpyCall = firstSpy.calls.mostRecent().invocationOrder;
        var first2ndSpyCall = latterSpy.calls.first().invocationOrder;

        result.pass = latest1stSpyCall < first2ndSpyCall;

        if (result.pass) {
          result.message = 'Expected spy ' + firstSpy.and.identity + ' to not have been called before spy ' + latterSpy.and.identity + ', but it was';
        } else {
          var first1stSpyCall = firstSpy.calls.first().invocationOrder;
          var latest2ndSpyCall = latterSpy.calls.mostRecent().invocationOrder;

          if(first1stSpyCall < first2ndSpyCall) {
            result.message = 'Expected latest call to spy ' + firstSpy.and.identity + ' to have been called before first call to spy ' + latterSpy.and.identity + ' (no interleaved calls)';
          } else if (latest2ndSpyCall > latest1stSpyCall) {
            result.message = 'Expected first call to spy ' + latterSpy.and.identity + ' to have been called after latest call to spy ' + firstSpy.and.identity + ' (no interleaved calls)';
          } else {
            result.message = 'Expected spy ' + firstSpy.and.identity + ' to have been called before spy ' + latterSpy.and.identity;
          }
        }

        return result;
      }
    };
  }

  return toHaveBeenCalledBefore;
};

getJasmineRequireObj().toHaveBeenCalledTimes = function(j$) {

  var getErrorMsg = j$.formatErrorMsg('<toHaveBeenCalledTimes>', 'expect(<spyObj>).toHaveBeenCalledTimes(<Number>)');

  /**
   * {@link expect} the actual (a {@link Spy}) to have been called the specified number of times.
   * @function
   * @name matchers#toHaveBeenCalledTimes
   * @since 2.4.0
   * @param {Number} expected - The number of invocations to look for.
   * @example
   * expect(mySpy).toHaveBeenCalledTimes(3);
   */
  function toHaveBeenCalledTimes() {
    return {
      compare: function(actual, expected) {
        if (!j$.isSpy(actual)) {
          throw new Error(getErrorMsg('Expected a spy, but got ' + j$.pp(actual) + '.'));
        }

        var args = Array.prototype.slice.call(arguments, 0),
          result = { pass: false };

        if (!j$.isNumber_(expected)) {
          throw new Error(getErrorMsg('The expected times failed is a required argument and must be a number.'));
        }

        actual = args[0];
        var calls = actual.calls.count();
        var timesMessage = expected === 1 ? 'once' : expected + ' times';
        result.pass = calls === expected;
        result.message = result.pass ?
          'Expected spy ' + actual.and.identity + ' not to have been called ' + timesMessage + '. It was called ' +  calls + ' times.' :
          'Expected spy ' + actual.and.identity + ' to have been called ' + timesMessage + '. It was called ' +  calls + ' times.';
        return result;
      }
    };
  }

  return toHaveBeenCalledTimes;
};

getJasmineRequireObj().toHaveBeenCalledWith = function(j$) {

  var getErrorMsg = j$.formatErrorMsg('<toHaveBeenCalledWith>', 'expect(<spyObj>).toHaveBeenCalledWith(...arguments)');

  /**
   * {@link expect} the actual (a {@link Spy}) to have been called with particular arguments at least once.
   * @function
   * @name matchers#toHaveBeenCalledWith
   * @since 1.3.0
   * @param {...Object} - The arguments to look for
   * @example
   * expect(mySpy).toHaveBeenCalledWith('foo', 'bar', 2);
   */
  function toHaveBeenCalledWith(util, customEqualityTesters) {
    return {
      compare: function() {
        var args = Array.prototype.slice.call(arguments, 0),
          actual = args[0],
          expectedArgs = args.slice(1),
          result = { pass: false };

        if (!j$.isSpy(actual)) {
          throw new Error(getErrorMsg('Expected a spy, but got ' + j$.pp(actual) + '.'));
        }

        if (!actual.calls.any()) {
          result.message = function() {
            return 'Expected spy ' + actual.and.identity + ' to have been called with:\n' +
              '  ' + j$.pp(expectedArgs) +
              '\nbut it was never called.';
          };
          return result;
        }

        if (util.contains(actual.calls.allArgs(), expectedArgs, customEqualityTesters)) {
          result.pass = true;
          result.message = function() {
            return 'Expected spy ' + actual.and.identity + ' not to have been called with:\n' +
              '  ' + j$.pp(expectedArgs) +
              '\nbut it was.';
          };
        } else {
          result.message = function() {
            var prettyPrintedCalls = actual.calls.allArgs().map(function(argsForCall) {
              return '  ' + j$.pp(argsForCall);
            });

            var diffs = actual.calls.allArgs().map(function(argsForCall, callIx) {
            var diffBuilder = new j$.DiffBuilder();
              util.equals(argsForCall, expectedArgs, customEqualityTesters, diffBuilder);
              return 'Call ' + callIx + ':\n' +
                diffBuilder.getMessage().replace(/^/mg, '  ');
            });

            return 'Expected spy ' + actual.and.identity + ' to have been called with:\n' +
              '  ' + j$.pp(expectedArgs) + '\n' + '' +
              'but actual calls were:\n' +
              prettyPrintedCalls.join(',\n') + '.\n\n' +
              diffs.join('\n');
          };
        }

        return result;
      }
    };
  }

  return toHaveBeenCalledWith;
};

getJasmineRequireObj().toHaveClass = function(j$) {
  /**
   * {@link expect} the actual value to be a DOM element that has the expected class
   * @function
   * @name matchers#toHaveClass
   * @since 3.0.0
   * @param {Object} expected - The class name to test for
   * @example
   * var el = document.createElement('div');
   * el.className = 'foo bar baz';
   * expect(el).toHaveClass('bar');
   */
  function toHaveClass(util, customEqualityTesters) {
    return {
      compare: function(actual, expected) {
        if (!isElement(actual)) {
          throw new Error(j$.pp(actual) + ' is not a DOM element');
        }

        return {
          pass: actual.classList.contains(expected)
        };
      }
    };
  }

  function isElement(maybeEl) {
    return maybeEl &&
      maybeEl.classList &&
      j$.isFunction_(maybeEl.classList.contains);
  }

  return toHaveClass;
};

getJasmineRequireObj().toMatch = function(j$) {

  var getErrorMsg = j$.formatErrorMsg('<toMatch>', 'expect(<expectation>).toMatch(<string> || <regexp>)');

  /**
   * {@link expect} the actual value to match a regular expression
   * @function
   * @name matchers#toMatch
   * @since 1.3.0
   * @param {RegExp|String} expected - Value to look for in the string.
   * @example
   * expect("my string").toMatch(/string$/);
   * expect("other string").toMatch("her");
   */
  function toMatch() {
    return {
      compare: function(actual, expected) {
        if (!j$.isString_(expected) && !j$.isA_('RegExp', expected)) {
          throw new Error(getErrorMsg('Expected is not a String or a RegExp'));
        }

        var regexp = new RegExp(expected);

        return {
          pass: regexp.test(actual)
        };
      }
    };
  }

  return toMatch;
};

getJasmineRequireObj().toThrow = function(j$) {

  var getErrorMsg = j$.formatErrorMsg('<toThrow>', 'expect(function() {<expectation>}).toThrow()');

  /**
   * {@link expect} a function to `throw` something.
   * @function
   * @name matchers#toThrow
   * @since 2.0.0
   * @param {Object} [expected] - Value that should be thrown. If not provided, simply the fact that something was thrown will be checked.
   * @example
   * expect(function() { return 'things'; }).toThrow('foo');
   * expect(function() { return 'stuff'; }).toThrow();
   */
  function toThrow(util) {
    return {
      compare: function(actual, expected) {
        var result = { pass: false },
          threw = false,
          thrown;

        if (typeof actual != 'function') {
          throw new Error(getErrorMsg('Actual is not a Function'));
        }

        try {
          actual();
        } catch (e) {
          threw = true;
          thrown = e;
        }

        if (!threw) {
          result.message = 'Expected function to throw an exception.';
          return result;
        }

        if (arguments.length == 1) {
          result.pass = true;
          result.message = function() { return 'Expected function not to throw, but it threw ' + j$.pp(thrown) + '.'; };

          return result;
        }

        if (util.equals(thrown, expected)) {
          result.pass = true;
          result.message = function() { return 'Expected function not to throw ' + j$.pp(expected) + '.'; };
        } else {
          result.message = function() { return 'Expected function to throw ' + j$.pp(expected) + ', but it threw ' +  j$.pp(thrown) + '.'; };
        }

        return result;
      }
    };
  }

  return toThrow;
};

getJasmineRequireObj().toThrowError = function(j$) {

  var getErrorMsg =  j$.formatErrorMsg('<toThrowError>', 'expect(function() {<expectation>}).toThrowError(<ErrorConstructor>, <message>)');

  /**
   * {@link expect} a function to `throw` an `Error`.
   * @function
   * @name matchers#toThrowError
   * @since 2.0.0
   * @param {Error} [expected] - `Error` constructor the object that was thrown needs to be an instance of. If not provided, `Error` will be used.
   * @param {RegExp|String} [message] - The message that should be set on the thrown `Error`
   * @example
   * expect(function() { return 'things'; }).toThrowError(MyCustomError, 'message');
   * expect(function() { return 'things'; }).toThrowError(MyCustomError, /bar/);
   * expect(function() { return 'stuff'; }).toThrowError(MyCustomError);
   * expect(function() { return 'other'; }).toThrowError(/foo/);
   * expect(function() { return 'other'; }).toThrowError();
   */
  function toThrowError () {
    return {
      compare: function(actual) {
        var errorMatcher = getMatcher.apply(null, arguments),
          thrown;

        if (typeof actual != 'function') {
          throw new Error(getErrorMsg('Actual is not a Function'));
        }

        try {
          actual();
          return fail('Expected function to throw an Error.');
        } catch (e) {
          thrown = e;
        }

        if (!j$.isError_(thrown)) {
          return fail(function() { return 'Expected function to throw an Error, but it threw ' + j$.pp(thrown) + '.'; });
        }

        return errorMatcher.match(thrown);
      }
    };

    function getMatcher() {
      var expected, errorType;

      if (arguments[2]) {
        errorType = arguments[1];
        expected = arguments[2];
        if (!isAnErrorType(errorType)) {
          throw new Error(getErrorMsg('Expected error type is not an Error.'));
        }

        return exactMatcher(expected, errorType);
      } else if (arguments[1]) {
        expected = arguments[1];

        if (isAnErrorType(arguments[1])) {
          return exactMatcher(null, arguments[1]);
        } else {
          return exactMatcher(arguments[1], null);
        }
      } else {
        return anyMatcher();
      }
    }

    function anyMatcher() {
      return {
        match: function(error) {
          return pass('Expected function not to throw an Error, but it threw ' + j$.fnNameFor(error) + '.');
        }
      };
    }

    function exactMatcher(expected, errorType) {
      if (expected && !isStringOrRegExp(expected)) {
        if (errorType) {
          throw new Error(getErrorMsg('Expected error message is not a string or RegExp.'));
        } else {
          throw new Error(getErrorMsg('Expected is not an Error, string, or RegExp.'));
        }
      }

      function messageMatch(message) {
        if (typeof expected == 'string') {
          return expected == message;
        } else {
          return expected.test(message);
        }
      }

      var errorTypeDescription = errorType ? j$.fnNameFor(errorType) : 'an exception';

      function thrownDescription(thrown) {
        var thrownName = errorType ? j$.fnNameFor(thrown.constructor) : 'an exception',
            thrownMessage = '';

        if (expected) {
          thrownMessage = ' with message ' + j$.pp(thrown.message);
        }

        return thrownName + thrownMessage;
      }

      function messageDescription() {
        if (expected === null) {
          return '';
        } else if (expected instanceof RegExp) {
          return ' with a message matching ' + j$.pp(expected);
        } else {
          return ' with message ' + j$.pp(expected);
        }
      }

      function matches(error) {
        return (errorType === null || error instanceof errorType) &&
          (expected === null || messageMatch(error.message));
      }

      return {
        match: function(thrown) {
          if (matches(thrown)) {
            return pass(function() {
              return 'Expected function not to throw ' + errorTypeDescription + messageDescription() + '.';
            });
          } else {
            return fail(function() {
              return 'Expected function to throw ' + errorTypeDescription + messageDescription() +
                ', but it threw ' + thrownDescription(thrown) + '.';
            });
          }
        }
      };
    }

    function isStringOrRegExp(potential) {
      return potential instanceof RegExp || (typeof potential == 'string');
    }

    function isAnErrorType(type) {
      if (typeof type !== 'function') {
        return false;
      }

      var Surrogate = function() {};
      Surrogate.prototype = type.prototype;
      return j$.isError_(new Surrogate());
    }
  }

  function pass(message) {
    return {
      pass: true,
      message: message
    };
  }

  function fail(message) {
    return {
      pass: false,
      message: message
    };
  }

  return toThrowError;
};

getJasmineRequireObj().toThrowMatching = function(j$) {
  var usageError =  j$.formatErrorMsg('<toThrowMatching>', 'expect(function() {<expectation>}).toThrowMatching(<Predicate>)');

  /**
   * {@link expect} a function to `throw` something matching a predicate.
   * @function
   * @name matchers#toThrowMatching
   * @since 3.0.0
   * @param {Function} predicate - A function that takes the thrown exception as its parameter and returns true if it matches.
   * @example
   * expect(function() { throw new Error('nope'); }).toThrowMatching(function(thrown) { return thrown.message === 'nope'; });
   */
  function toThrowMatching() {
    return {
      compare: function(actual, predicate) {
        var thrown;

        if (typeof actual !== 'function') {
          throw new Error(usageError('Actual is not a Function'));
        }

        if (typeof predicate !== 'function') {
          throw new Error(usageError('Predicate is not a Function'));
        }

        try {
          actual();
          return fail('Expected function to throw an exception.');
        } catch (e) {
          thrown = e;
        }

        if (predicate(thrown)) {
          return pass('Expected function not to throw an exception matching a predicate.');
        } else {
            return fail(function() {
              return 'Expected function to throw an exception matching a predicate, ' +
                'but it threw ' + thrownDescription(thrown) + '.';
            });
        }
      }
    };
  }

  function thrownDescription(thrown) {
    if (thrown && thrown.constructor) {
      return j$.fnNameFor(thrown.constructor) + ' with message ' +
        j$.pp(thrown.message);
    } else {
      return j$.pp(thrown);
    }
  }

  function pass(message) {
    return {
      pass: true,
      message: message
    };
  }

  function fail(message) {
    return {
      pass: false,
      message: message
    };
  }

  return toThrowMatching;
};

getJasmineRequireObj().MockDate = function() {
  function MockDate(global) {
    var self = this;
    var currentTime = 0;

    if (!global || !global.Date) {
      self.install = function() {};
      self.tick = function() {};
      self.uninstall = function() {};
      return self;
    }

    var GlobalDate = global.Date;

    self.install = function(mockDate) {
      if (mockDate instanceof GlobalDate) {
        currentTime = mockDate.getTime();
      } else {
        currentTime = new GlobalDate().getTime();
      }

      global.Date = FakeDate;
    };

    self.tick = function(millis) {
      millis = millis || 0;
      currentTime = currentTime + millis;
    };

    self.uninstall = function() {
      currentTime = 0;
      global.Date = GlobalDate;
    };

    createDateProperties();

    return self;

    function FakeDate() {
      switch (arguments.length) {
        case 0:
          return new GlobalDate(currentTime);
        case 1:
          return new GlobalDate(arguments[0]);
        case 2:
          return new GlobalDate(arguments[0], arguments[1]);
        case 3:
          return new GlobalDate(arguments[0], arguments[1], arguments[2]);
        case 4:
          return new GlobalDate(
            arguments[0],
            arguments[1],
            arguments[2],
            arguments[3]
          );
        case 5:
          return new GlobalDate(
            arguments[0],
            arguments[1],
            arguments[2],
            arguments[3],
            arguments[4]
          );
        case 6:
          return new GlobalDate(
            arguments[0],
            arguments[1],
            arguments[2],
            arguments[3],
            arguments[4],
            arguments[5]
          );
        default:
          return new GlobalDate(
            arguments[0],
            arguments[1],
            arguments[2],
            arguments[3],
            arguments[4],
            arguments[5],
            arguments[6]
          );
      }
    }

    function createDateProperties() {
      FakeDate.prototype = GlobalDate.prototype;

      FakeDate.now = function() {
        if (GlobalDate.now) {
          return currentTime;
        } else {
          throw new Error('Browser does not support Date.now()');
        }
      };

      FakeDate.toSource = GlobalDate.toSource;
      FakeDate.toString = GlobalDate.toString;
      FakeDate.parse = GlobalDate.parse;
      FakeDate.UTC = GlobalDate.UTC;
    }
  }

  return MockDate;
};

getJasmineRequireObj().pp = function(j$) {
  function PrettyPrinter() {
    this.ppNestLevel_ = 0;
    this.seen = [];
    this.length = 0;
    this.stringParts = [];
  }

  function hasCustomToString(value) {
    // value.toString !== Object.prototype.toString if value has no custom toString but is from another context (e.g.
    // iframe, web worker)
    try {
      return (
        j$.isFunction_(value.toString) &&
        value.toString !== Object.prototype.toString &&
        value.toString() !== Object.prototype.toString.call(value)
      );
    } catch (e) {
      // The custom toString() threw.
      return true;
    }
  }

  PrettyPrinter.prototype.format = function(value) {
    this.ppNestLevel_++;
    try {
      if (j$.util.isUndefined(value)) {
        this.emitScalar('undefined');
      } else if (value === null) {
        this.emitScalar('null');
      } else if (value === 0 && 1 / value === -Infinity) {
        this.emitScalar('-0');
      } else if (value === j$.getGlobal()) {
        this.emitScalar('<global>');
      } else if (value.jasmineToString) {
        this.emitScalar(value.jasmineToString());
      } else if (typeof value === 'string') {
        this.emitString(value);
      } else if (j$.isSpy(value)) {
        this.emitScalar('spy on ' + value.and.identity);
      } else if (j$.isSpy(value.toString)) {
        this.emitScalar('spy on ' + value.toString.and.identity);
      } else if (value instanceof RegExp) {
        this.emitScalar(value.toString());
      } else if (typeof value === 'function') {
        this.emitScalar('Function');
      } else if (j$.isDomNode(value)) {
        if (value.tagName) {
          this.emitDomElement(value);
        } else {
          this.emitScalar('HTMLNode');
        }
      } else if (value instanceof Date) {
        this.emitScalar('Date(' + value + ')');
      } else if (j$.isSet(value)) {
        this.emitSet(value);
      } else if (j$.isMap(value)) {
        this.emitMap(value);
      } else if (j$.isTypedArray_(value)) {
        this.emitTypedArray(value);
      } else if (
        value.toString &&
        typeof value === 'object' &&
        !j$.isArray_(value) &&
        hasCustomToString(value)
      ) {
        try {
          this.emitScalar(value.toString());
        } catch (e) {
          this.emitScalar('has-invalid-toString-method');
        }
      } else if (j$.util.arrayContains(this.seen, value)) {
        this.emitScalar(
          '<circular reference: ' +
            (j$.isArray_(value) ? 'Array' : 'Object') +
            '>'
        );
      } else if (j$.isArray_(value) || j$.isA_('Object', value)) {
        this.seen.push(value);
        if (j$.isArray_(value)) {
          this.emitArray(value);
        } else {
          this.emitObject(value);
        }
        this.seen.pop();
      } else {
        this.emitScalar(value.toString());
      }
    } catch (e) {
      if (this.ppNestLevel_ > 1 || !(e instanceof MaxCharsReachedError)) {
        throw e;
      }
    } finally {
      this.ppNestLevel_--;
    }
  };

  PrettyPrinter.prototype.iterateObject = function(obj, fn) {
    var objKeys = keys(obj, j$.isArray_(obj));
    var isGetter = function isGetter(prop) {};

    if (obj.__lookupGetter__) {
      isGetter = function isGetter(prop) {
        var getter = obj.__lookupGetter__(prop);
        return !j$.util.isUndefined(getter) && getter !== null;
      };
    }
    var length = Math.min(objKeys.length, j$.MAX_PRETTY_PRINT_ARRAY_LENGTH);
    for (var i = 0; i < length; i++) {
      var property = objKeys[i];
      fn(property, isGetter(property));
    }

    return objKeys.length > length;
  };

  PrettyPrinter.prototype.emitScalar = function(value) {
    this.append(value);
  };

  PrettyPrinter.prototype.emitString = function(value) {
    this.append("'" + value + "'");
  };

  PrettyPrinter.prototype.emitArray = function(array) {
    if (this.ppNestLevel_ > j$.MAX_PRETTY_PRINT_DEPTH) {
      this.append('Array');
      return;
    }
    var length = Math.min(array.length, j$.MAX_PRETTY_PRINT_ARRAY_LENGTH);
    this.append('[ ');
    for (var i = 0; i < length; i++) {
      if (i > 0) {
        this.append(', ');
      }
      this.format(array[i]);
    }
    if (array.length > length) {
      this.append(', ...');
    }

    var self = this;
    var first = array.length === 0;
    var truncated = this.iterateObject(array, function(property, isGetter) {
      if (first) {
        first = false;
      } else {
        self.append(', ');
      }

      self.formatProperty(array, property, isGetter);
    });

    if (truncated) {
      this.append(', ...');
    }

    this.append(' ]');
  };

  PrettyPrinter.prototype.emitSet = function(set) {
    if (this.ppNestLevel_ > j$.MAX_PRETTY_PRINT_DEPTH) {
      this.append('Set');
      return;
    }
    this.append('Set( ');
    var size = Math.min(set.size, j$.MAX_PRETTY_PRINT_ARRAY_LENGTH);
    var i = 0;
    set.forEach(function(value, key) {
      if (i >= size) {
        return;
      }
      if (i > 0) {
        this.append(', ');
      }
      this.format(value);

      i++;
    }, this);
    if (set.size > size) {
      this.append(', ...');
    }
    this.append(' )');
  };

  PrettyPrinter.prototype.emitMap = function(map) {
    if (this.ppNestLevel_ > j$.MAX_PRETTY_PRINT_DEPTH) {
      this.append('Map');
      return;
    }
    this.append('Map( ');
    var size = Math.min(map.size, j$.MAX_PRETTY_PRINT_ARRAY_LENGTH);
    var i = 0;
    map.forEach(function(value, key) {
      if (i >= size) {
        return;
      }
      if (i > 0) {
        this.append(', ');
      }
      this.format([key, value]);

      i++;
    }, this);
    if (map.size > size) {
      this.append(', ...');
    }
    this.append(' )');
  };

  PrettyPrinter.prototype.emitObject = function(obj) {
    var ctor = obj.constructor,
      constructorName;

    constructorName =
      typeof ctor === 'function' && obj instanceof ctor
        ? j$.fnNameFor(obj.constructor)
        : 'null';

    this.append(constructorName);

    if (this.ppNestLevel_ > j$.MAX_PRETTY_PRINT_DEPTH) {
      return;
    }

    var self = this;
    this.append('({ ');
    var first = true;

    var truncated = this.iterateObject(obj, function(property, isGetter) {
      if (first) {
        first = false;
      } else {
        self.append(', ');
      }

      self.formatProperty(obj, property, isGetter);
    });

    if (truncated) {
      this.append(', ...');
    }

    this.append(' })');
  };

  PrettyPrinter.prototype.emitTypedArray = function(arr) {
    var constructorName = j$.fnNameFor(arr.constructor),
      limitedArray = Array.prototype.slice.call(
        arr,
        0,
        j$.MAX_PRETTY_PRINT_ARRAY_LENGTH
      ),
      itemsString = Array.prototype.join.call(limitedArray, ', ');

    if (limitedArray.length !== arr.length) {
      itemsString += ', ...';
    }

    this.append(constructorName + ' [ ' + itemsString + ' ]');
  };

  PrettyPrinter.prototype.emitDomElement = function(el) {
    var tagName = el.tagName.toLowerCase(),
      attrs = el.attributes,
      i,
      len = attrs.length,
      out = '<' + tagName,
      attr;

    for (i = 0; i < len; i++) {
      attr = attrs[i];
      out += ' ' + attr.name;

      if (attr.value !== '') {
        out += '="' + attr.value + '"';
      }
    }

    out += '>';

    if (el.childElementCount !== 0 || el.textContent !== '') {
      out += '...</' + tagName + '>';
    }

    this.append(out);
  };

  PrettyPrinter.prototype.formatProperty = function(obj, property, isGetter) {
    this.append(property);
    this.append(': ');
    if (isGetter) {
      this.append('<getter>');
    } else {
      this.format(obj[property]);
    }
  };

  PrettyPrinter.prototype.append = function(value) {
    // This check protects us from the rare case where an object has overriden
    // `toString()` with an invalid implementation (returning a non-string).
    if (typeof value !== 'string') {
      value = Object.prototype.toString.call(value);
    }

    var result = truncate(value, j$.MAX_PRETTY_PRINT_CHARS - this.length);
    this.length += result.value.length;
    this.stringParts.push(result.value);

    if (result.truncated) {
      throw new MaxCharsReachedError();
    }
  };

  function truncate(s, maxlen) {
    if (s.length <= maxlen) {
      return { value: s, truncated: false };
    }

    s = s.substring(0, maxlen - 4) + ' ...';
    return { value: s, truncated: true };
  }

  function MaxCharsReachedError() {
    this.message =
      'Exceeded ' +
      j$.MAX_PRETTY_PRINT_CHARS +
      ' characters while pretty-printing a value';
  }

  MaxCharsReachedError.prototype = new Error();

  function keys(obj, isArray) {
    var allKeys = Object.keys
      ? Object.keys(obj)
      : (function(o) {
          var keys = [];
          for (var key in o) {
            if (j$.util.has(o, key)) {
              keys.push(key);
            }
          }
          return keys;
        })(obj);

    if (!isArray) {
      return allKeys;
    }

    if (allKeys.length === 0) {
      return allKeys;
    }

    var extraKeys = [];
    for (var i = 0; i < allKeys.length; i++) {
      if (!/^[0-9]+$/.test(allKeys[i])) {
        extraKeys.push(allKeys[i]);
      }
    }

    return extraKeys;
  }
  return function(value) {
    var prettyPrinter = new PrettyPrinter();
    prettyPrinter.format(value);
    return prettyPrinter.stringParts.join('');
  };
};

getJasmineRequireObj().QueueRunner = function(j$) {
  function StopExecutionError() {}
  StopExecutionError.prototype = new Error();
  j$.StopExecutionError = StopExecutionError;

  function once(fn) {
    var called = false;
    return function(arg) {
      if (!called) {
        called = true;
        // Direct call using single parameter, because cleanup/next does not need more
        fn(arg);
      }
      return null;
    };
  }

  function emptyFn() {}

  function QueueRunner(attrs) {
    var queueableFns = attrs.queueableFns || [];
    this.queueableFns = queueableFns.concat(attrs.cleanupFns || []);
    this.firstCleanupIx = queueableFns.length;
    this.onComplete = attrs.onComplete || emptyFn;
    this.clearStack =
      attrs.clearStack ||
      function(fn) {
        fn();
      };
    this.onException = attrs.onException || emptyFn;
    this.userContext = attrs.userContext || new j$.UserContext();
    this.timeout = attrs.timeout || {
      setTimeout: setTimeout,
      clearTimeout: clearTimeout
    };
    this.fail = attrs.fail || emptyFn;
    this.globalErrors = attrs.globalErrors || {
      pushListener: emptyFn,
      popListener: emptyFn
    };
    this.completeOnFirstError = !!attrs.completeOnFirstError;
    this.errored = false;

    if (typeof this.onComplete !== 'function') {
      throw new Error('invalid onComplete ' + JSON.stringify(this.onComplete));
    }
    this.deprecated = attrs.deprecated;
  }

  QueueRunner.prototype.execute = function() {
    var self = this;
    this.handleFinalError = function(message, source, lineno, colno, error) {
      // Older browsers would send the error as the first parameter. HTML5
      // specifies the the five parameters above. The error instance should
      // be preffered, otherwise the call stack would get lost.
      self.onException(error || message);
    };
    this.globalErrors.pushListener(this.handleFinalError);
    this.run(0);
  };

  QueueRunner.prototype.skipToCleanup = function(lastRanIndex) {
    if (lastRanIndex < this.firstCleanupIx) {
      this.run(this.firstCleanupIx);
    } else {
      this.run(lastRanIndex + 1);
    }
  };

  QueueRunner.prototype.clearTimeout = function(timeoutId) {
    Function.prototype.apply.apply(this.timeout.clearTimeout, [
      j$.getGlobal(),
      [timeoutId]
    ]);
  };

  QueueRunner.prototype.setTimeout = function(fn, timeout) {
    return Function.prototype.apply.apply(this.timeout.setTimeout, [
      j$.getGlobal(),
      [fn, timeout]
    ]);
  };

  QueueRunner.prototype.attempt = function attempt(iterativeIndex) {
    var self = this,
      completedSynchronously = true,
      handleError = function handleError(error) {
        onException(error);
        next(error);
      },
      cleanup = once(function cleanup() {
        if (timeoutId !== void 0) {
          self.clearTimeout(timeoutId);
        }
        self.globalErrors.popListener(handleError);
      }),
      next = once(function next(err) {
        cleanup();

        if (j$.isError_(err)) {
          if (!(err instanceof StopExecutionError) && !err.jasmineMessage) {
            self.fail(err);
          }
          self.errored = errored = true;
        }

        function runNext() {
          if (self.completeOnFirstError && errored) {
            self.skipToCleanup(iterativeIndex);
          } else {
            self.run(iterativeIndex + 1);
          }
        }

        if (completedSynchronously) {
          self.setTimeout(runNext);
        } else {
          runNext();
        }
      }),
      errored = false,
      queueableFn = self.queueableFns[iterativeIndex],
      timeoutId;

    next.fail = function nextFail() {
      self.fail.apply(null, arguments);
      self.errored = errored = true;
      next();
    };

    self.globalErrors.pushListener(handleError);

    if (queueableFn.timeout !== undefined) {
      var timeoutInterval = queueableFn.timeout || j$.DEFAULT_TIMEOUT_INTERVAL;
      timeoutId = self.setTimeout(function() {
        var error = new Error(
          'Timeout - Async function did not complete within ' +
            timeoutInterval +
            'ms ' +
            (queueableFn.timeout
              ? '(custom timeout)'
              : '(set by jasmine.DEFAULT_TIMEOUT_INTERVAL)')
        );
        onException(error);
        next();
      }, timeoutInterval);
    }

    try {
      if (queueableFn.fn.length === 0) {
        var maybeThenable = queueableFn.fn.call(self.userContext);

        if (maybeThenable && j$.isFunction_(maybeThenable.then)) {
          maybeThenable.then(next, onPromiseRejection);
          completedSynchronously = false;
          return { completedSynchronously: false };
        }
      } else {
        queueableFn.fn.call(self.userContext, next);
        completedSynchronously = false;
        return { completedSynchronously: false };
      }
    } catch (e) {
      onException(e);
      self.errored = errored = true;
    }

    cleanup();
    return { completedSynchronously: true, errored: errored };

    function onException(e) {
      self.onException(e);
      self.errored = errored = true;
    }

    function onPromiseRejection(e) {
      onException(e);
      next();
    }
  };

  QueueRunner.prototype.run = function(recursiveIndex) {
    var length = this.queueableFns.length,
      self = this,
      iterativeIndex;

    for (
      iterativeIndex = recursiveIndex;
      iterativeIndex < length;
      iterativeIndex++
    ) {
      var result = this.attempt(iterativeIndex);

      if (!result.completedSynchronously) {
        return;
      }

      self.errored = self.errored || result.errored;

      if (this.completeOnFirstError && result.errored) {
        this.skipToCleanup(iterativeIndex);
        return;
      }
    }

    this.clearStack(function() {
      self.globalErrors.popListener(self.handleFinalError);
      self.onComplete(self.errored && new StopExecutionError());
    });
  };

  return QueueRunner;
};

getJasmineRequireObj().ReportDispatcher = function(j$) {
  function ReportDispatcher(methods, queueRunnerFactory) {
    var dispatchedMethods = methods || [];

    for (var i = 0; i < dispatchedMethods.length; i++) {
      var method = dispatchedMethods[i];
      this[method] = (function(m) {
        return function() {
          dispatch(m, arguments);
        };
      })(method);
    }

    var reporters = [];
    var fallbackReporter = null;

    this.addReporter = function(reporter) {
      reporters.push(reporter);
    };

    this.provideFallbackReporter = function(reporter) {
      fallbackReporter = reporter;
    };

    this.clearReporters = function() {
      reporters = [];
    };

    return this;

    function dispatch(method, args) {
      if (reporters.length === 0 && fallbackReporter !== null) {
        reporters.push(fallbackReporter);
      }
      var onComplete = args[args.length - 1];
      args = j$.util.argsToArray(args).splice(0, args.length - 1);
      var fns = [];
      for (var i = 0; i < reporters.length; i++) {
        var reporter = reporters[i];
        addFn(fns, reporter, method, args);
      }

      queueRunnerFactory({
        queueableFns: fns,
        onComplete: onComplete,
        isReporter: true
      });
    }

    function addFn(fns, reporter, method, args) {
      var fn = reporter[method];
      if (!fn) {
        return;
      }

      var thisArgs = j$.util.cloneArgs(args);
      if (fn.length <= 1) {
        fns.push({
          fn: function() {
            return fn.apply(reporter, thisArgs);
          }
        });
      } else {
        fns.push({
          fn: function(done) {
            return fn.apply(reporter, thisArgs.concat([done]));
          }
        });
      }
    }
  }

  return ReportDispatcher;
};

getJasmineRequireObj().interface = function(jasmine, env) {
  var jasmineInterface = {
    /**
     * Callback passed to parts of the Jasmine base interface.
     *
     * By default Jasmine assumes this function completes synchronously.
     * If you have code that you need to test asynchronously, you can declare that you receive a `done` callback, return a Promise, or use the `async` keyword if it is supported in your environment.
     * @callback implementationCallback
     * @param {Function} [done] Used to specify to Jasmine that this callback is asynchronous and Jasmine should wait until it has been called before moving on.
     * @returns {} Optionally return a Promise instead of using `done` to cause Jasmine to wait for completion.
     */

    /**
     * Create a group of specs (often called a suite).
     *
     * Calls to `describe` can be nested within other calls to compose your suite as a tree.
     * @name describe
     * @since 1.3.0
     * @function
     * @global
     * @param {String} description Textual description of the group
     * @param {Function} specDefinitions Function for Jasmine to invoke that will define inner suites and specs
     */
    describe: function(description, specDefinitions) {
      return env.describe(description, specDefinitions);
    },

    /**
     * A temporarily disabled [`describe`]{@link describe}
     *
     * Specs within an `xdescribe` will be marked pending and not executed
     * @name xdescribe
     * @since 1.3.0
     * @function
     * @global
     * @param {String} description Textual description of the group
     * @param {Function} specDefinitions Function for Jasmine to invoke that will define inner suites and specs
     */
    xdescribe: function(description, specDefinitions) {
      return env.xdescribe(description, specDefinitions);
    },

    /**
     * A focused [`describe`]{@link describe}
     *
     * If suites or specs are focused, only those that are focused will be executed
     * @see fit
     * @name fdescribe
     * @since 2.1.0
     * @function
     * @global
     * @param {String} description Textual description of the group
     * @param {Function} specDefinitions Function for Jasmine to invoke that will define inner suites and specs
     */
    fdescribe: function(description, specDefinitions) {
      return env.fdescribe(description, specDefinitions);
    },

    /**
     * Define a single spec. A spec should contain one or more {@link expect|expectations} that test the state of the code.
     *
     * A spec whose expectations all succeed will be passing and a spec with any failures will fail.
     * @name it
     * @since 1.3.0
     * @function
     * @global
     * @param {String} description Textual description of what this spec is checking
     * @param {implementationCallback} [testFunction] Function that contains the code of your test. If not provided the test will be `pending`.
     * @param {Int} [timeout={@link jasmine.DEFAULT_TIMEOUT_INTERVAL}] Custom timeout for an async spec.
     * @see async
     */
    it: function() {
      return env.it.apply(env, arguments);
    },

    /**
     * A temporarily disabled [`it`]{@link it}
     *
     * The spec will report as `pending` and will not be executed.
     * @name xit
     * @since 1.3.0
     * @function
     * @global
     * @param {String} description Textual description of what this spec is checking.
     * @param {implementationCallback} [testFunction] Function that contains the code of your test. Will not be executed.
     */
    xit: function() {
      return env.xit.apply(env, arguments);
    },

    /**
     * A focused [`it`]{@link it}
     *
     * If suites or specs are focused, only those that are focused will be executed.
     * @name fit
     * @since 2.1.0
     * @function
     * @global
     * @param {String} description Textual description of what this spec is checking.
     * @param {implementationCallback} testFunction Function that contains the code of your test.
     * @param {Int} [timeout={@link jasmine.DEFAULT_TIMEOUT_INTERVAL}] Custom timeout for an async spec.
     * @see async
     */
    fit: function() {
      return env.fit.apply(env, arguments);
    },

    /**
     * Run some shared setup before each of the specs in the {@link describe} in which it is called.
     * @name beforeEach
     * @since 1.3.0
     * @function
     * @global
     * @param {implementationCallback} [function] Function that contains the code to setup your specs.
     * @param {Int} [timeout={@link jasmine.DEFAULT_TIMEOUT_INTERVAL}] Custom timeout for an async beforeEach.
     * @see async
     */
    beforeEach: function() {
      return env.beforeEach.apply(env, arguments);
    },

    /**
     * Run some shared teardown after each of the specs in the {@link describe} in which it is called.
     * @name afterEach
     * @since 1.3.0
     * @function
     * @global
     * @param {implementationCallback} [function] Function that contains the code to teardown your specs.
     * @param {Int} [timeout={@link jasmine.DEFAULT_TIMEOUT_INTERVAL}] Custom timeout for an async afterEach.
     * @see async
     */
    afterEach: function() {
      return env.afterEach.apply(env, arguments);
    },

    /**
     * Run some shared setup once before all of the specs in the {@link describe} are run.
     *
     * _Note:_ Be careful, sharing the setup from a beforeAll makes it easy to accidentally leak state between your specs so that they erroneously pass or fail.
     * @name beforeAll
     * @since 2.1.0
     * @function
     * @global
     * @param {implementationCallback} [function] Function that contains the code to setup your specs.
     * @param {Int} [timeout={@link jasmine.DEFAULT_TIMEOUT_INTERVAL}] Custom timeout for an async beforeAll.
     * @see async
     */
    beforeAll: function() {
      return env.beforeAll.apply(env, arguments);
    },

    /**
     * Run some shared teardown once after all of the specs in the {@link describe} are run.
     *
     * _Note:_ Be careful, sharing the teardown from a afterAll makes it easy to accidentally leak state between your specs so that they erroneously pass or fail.
     * @name afterAll
     * @since 2.1.0
     * @function
     * @global
     * @param {implementationCallback} [function] Function that contains the code to teardown your specs.
     * @param {Int} [timeout={@link jasmine.DEFAULT_TIMEOUT_INTERVAL}] Custom timeout for an async afterAll.
     * @see async
     */
    afterAll: function() {
      return env.afterAll.apply(env, arguments);
    },

    /**
     * Create an expectation for a spec.
     * @name expect
     * @since 1.3.0
     * @function
     * @global
     * @param {Object} actual - Actual computed value to test expectations against.
     * @return {matchers}
     */
    expect: function(actual) {
      return env.expect(actual);
    },

    /**
     * Create an asynchronous expectation for a spec. Note that the matchers
     * that are provided by an asynchronous expectation all return promises
     * which must be either returned from the spec or waited for using `await`
     * in order for Jasmine to associate them with the correct spec.
     * @name expectAsync
     * @since 3.3.0
     * @function
     * @global
     * @param {Object} actual - Actual computed value to test expectations against.
     * @return {async-matchers}
     * @example
     * await expectAsync(somePromise).toBeResolved();
     * @example
     * return expectAsync(somePromise).toBeResolved();
     */
    expectAsync: function(actual) {
      return env.expectAsync(actual);
    },

    /**
     * Mark a spec as pending, expectation results will be ignored.
     * @name pending
     * @since 2.0.0
     * @function
     * @global
     * @param {String} [message] - Reason the spec is pending.
     */
    pending: function() {
      return env.pending.apply(env, arguments);
    },

    /**
     * Explicitly mark a spec as failed.
     * @name fail
     * @since 2.1.0
     * @function
     * @global
     * @param {String|Error} [error] - Reason for the failure.
     */
    fail: function() {
      return env.fail.apply(env, arguments);
    },

    /**
     * Install a spy onto an existing object.
     * @name spyOn
     * @since 1.3.0
     * @function
     * @global
     * @param {Object} obj - The object upon which to install the {@link Spy}.
     * @param {String} methodName - The name of the method to replace with a {@link Spy}.
     * @returns {Spy}
     */
    spyOn: function(obj, methodName) {
      return env.spyOn(obj, methodName);
    },

    /**
     * Install a spy on a property installed with `Object.defineProperty` onto an existing object.
     * @name spyOnProperty
     * @since 2.6.0
     * @function
     * @global
     * @param {Object} obj - The object upon which to install the {@link Spy}
     * @param {String} propertyName - The name of the property to replace with a {@link Spy}.
     * @param {String} [accessType=get] - The access type (get|set) of the property to {@link Spy} on.
     * @returns {Spy}
     */
    spyOnProperty: function(obj, methodName, accessType) {
      return env.spyOnProperty(obj, methodName, accessType);
    },

    /**
     * Installs spies on all writable and configurable properties of an object.
     * @name spyOnAllFunctions
     * @since 3.2.1
     * @function
     * @global
     * @param {Object} obj - The object upon which to install the {@link Spy}s
     * @returns {Object} the spied object
     */
    spyOnAllFunctions: function(obj) {
      return env.spyOnAllFunctions(obj);
    },

    jsApiReporter: new jasmine.JsApiReporter({
      timer: new jasmine.Timer()
    }),

    /**
     * @namespace jasmine
     */
    jasmine: jasmine
  };

  /**
   * Add a custom equality tester for the current scope of specs.
   *
   * _Note:_ This is only callable from within a {@link beforeEach}, {@link it}, or {@link beforeAll}.
   * @name jasmine.addCustomEqualityTester
   * @since 2.0.0
   * @function
   * @param {Function} tester - A function which takes two arguments to compare and returns a `true` or `false` comparison result if it knows how to compare them, and `undefined` otherwise.
   * @see custom_equality
   */
  jasmine.addCustomEqualityTester = function(tester) {
    env.addCustomEqualityTester(tester);
  };

  /**
   * Add custom matchers for the current scope of specs.
   *
   * _Note:_ This is only callable from within a {@link beforeEach}, {@link it}, or {@link beforeAll}.
   * @name jasmine.addMatchers
   * @since 2.0.0
   * @function
   * @param {Object} matchers - Keys from this object will be the new matcher names.
   * @see custom_matcher
   */
  jasmine.addMatchers = function(matchers) {
    return env.addMatchers(matchers);
  };

  /**
   * Add custom async matchers for the current scope of specs.
   *
   * _Note:_ This is only callable from within a {@link beforeEach}, {@link it}, or {@link beforeAll}.
   * @name jasmine.addAsyncMatchers
   * @since 3.5.0
   * @function
   * @param {Object} matchers - Keys from this object will be the new async matcher names.
   * @see custom_matcher
   */
  jasmine.addAsyncMatchers = function(matchers) {
    return env.addAsyncMatchers(matchers);
  };

  /**
   * Get the currently booted mock {Clock} for this Jasmine environment.
   * @name jasmine.clock
   * @since 2.0.0
   * @function
   * @returns {Clock}
   */
  jasmine.clock = function() {
    return env.clock;
  };

  /**
   * Create a bare {@link Spy} object. This won't be installed anywhere and will not have any implementation behind it.
   * @name jasmine.createSpy
   * @since 1.3.0
   * @function
   * @param {String} [name] - Name to give the spy. This will be displayed in failure messages.
   * @param {Function} [originalFn] - Function to act as the real implementation.
   * @return {Spy}
   */
  jasmine.createSpy = function(name, originalFn) {
    return env.createSpy(name, originalFn);
  };

  /**
   * Create an object with multiple {@link Spy}s as its members.
   * @name jasmine.createSpyObj
   * @since 1.3.0
   * @function
   * @param {String} [baseName] - Base name for the spies in the object.
   * @param {String[]|Object} methodNames - Array of method names to create spies for, or Object whose keys will be method names and values the {@link Spy#and#returnValue|returnValue}.
   * @param {String[]|Object} [propertyNames] - Array of property names to create spies for, or Object whose keys will be propertynames and values the {@link Spy#and#returnValue|returnValue}.
   * @return {Object}
   */
  jasmine.createSpyObj = function(baseName, methodNames, propertyNames) {
    return env.createSpyObj(baseName, methodNames, propertyNames);
  };

  /**
   * Add a custom spy strategy for the current scope of specs.
   *
   * _Note:_ This is only callable from within a {@link beforeEach}, {@link it}, or {@link beforeAll}.
   * @name jasmine.addSpyStrategy
   * @since 3.5.0
   * @function
   * @param {String} name - The name of the strategy (i.e. what you call from `and`)
   * @param {Function} factory - Factory function that returns the plan to be executed.
   */
  jasmine.addSpyStrategy = function(name, factory) {
    return env.addSpyStrategy(name, factory);
  };

  /**
   * Set the default spy strategy for the current scope of specs.
   *
   * _Note:_ This is only callable from within a {@link beforeEach}, {@link it}, or {@link beforeAll}.
   * @name jasmine.setDefaultSpyStrategy
   * @function
   * @param {Function} defaultStrategyFn - a function that assigns a strategy
   * @example
   * beforeEach(function() {
   *   jasmine.setDefaultSpyStrategy(and => and.returnValue(true));
   * });
   */
  jasmine.setDefaultSpyStrategy = function(defaultStrategyFn) {
    return env.setDefaultSpyStrategy(defaultStrategyFn);
  };

  return jasmineInterface;
};

getJasmineRequireObj().Spy = function(j$) {
  var nextOrder = (function() {
    var order = 0;

    return function() {
      return order++;
    };
  })();

  /**
   * _Note:_ Do not construct this directly, use {@link spyOn}, {@link spyOnProperty}, {@link jasmine.createSpy}, or {@link jasmine.createSpyObj}
   * @constructor
   * @name Spy
   */
  function Spy(
    name,
    originalFn,
    customStrategies,
    defaultStrategyFn,
    getPromise
  ) {
    var numArgs = typeof originalFn === 'function' ? originalFn.length : 0,
      wrapper = makeFunc(numArgs, function() {
        return spy.apply(this, Array.prototype.slice.call(arguments));
      }),
      strategyDispatcher = new SpyStrategyDispatcher({
        name: name,
        fn: originalFn,
        getSpy: function() {
          return wrapper;
        },
        customStrategies: customStrategies,
        getPromise: getPromise
      }),
      callTracker = new j$.CallTracker(),
      spy = function() {
        /**
         * @name Spy.callData
         * @property {object} object - `this` context for the invocation.
         * @property {number} invocationOrder - Order of the invocation.
         * @property {Array} args - The arguments passed for this invocation.
         */
        var callData = {
          object: this,
          invocationOrder: nextOrder(),
          args: Array.prototype.slice.apply(arguments)
        };

        callTracker.track(callData);
        var returnValue = strategyDispatcher.exec(this, arguments);
        callData.returnValue = returnValue;

        return returnValue;
      };

    function makeFunc(length, fn) {
      switch (length) {
        case 1:
          return function(a) {
            return fn.apply(this, arguments);
          };
        case 2:
          return function(a, b) {
            return fn.apply(this, arguments);
          };
        case 3:
          return function(a, b, c) {
            return fn.apply(this, arguments);
          };
        case 4:
          return function(a, b, c, d) {
            return fn.apply(this, arguments);
          };
        case 5:
          return function(a, b, c, d, e) {
            return fn.apply(this, arguments);
          };
        case 6:
          return function(a, b, c, d, e, f) {
            return fn.apply(this, arguments);
          };
        case 7:
          return function(a, b, c, d, e, f, g) {
            return fn.apply(this, arguments);
          };
        case 8:
          return function(a, b, c, d, e, f, g, h) {
            return fn.apply(this, arguments);
          };
        case 9:
          return function(a, b, c, d, e, f, g, h, i) {
            return fn.apply(this, arguments);
          };
        default:
          return function() {
            return fn.apply(this, arguments);
          };
      }
    }

    for (var prop in originalFn) {
      if (prop === 'and' || prop === 'calls') {
        throw new Error(
          "Jasmine spies would overwrite the 'and' and 'calls' properties on the object being spied upon"
        );
      }

      wrapper[prop] = originalFn[prop];
    }

    /**
     * @member {SpyStrategy} - Accesses the default strategy for the spy. This strategy will be used
     * whenever the spy is called with arguments that don't match any strategy
     * created with {@link Spy#withArgs}.
     * @name Spy#and
     * @since 2.0.0
     * @example
     * spyOn(someObj, 'func').and.returnValue(42);
     */
    wrapper.and = strategyDispatcher.and;
    /**
     * Specifies a strategy to be used for calls to the spy that have the
     * specified arguments.
     * @name Spy#withArgs
     * @since 3.0.0
     * @function
     * @param {...*} args - The arguments to match
     * @type {SpyStrategy}
     * @example
     * spyOn(someObj, 'func').withArgs(1, 2, 3).and.returnValue(42);
     * someObj.func(1, 2, 3); // returns 42
     */
    wrapper.withArgs = function() {
      return strategyDispatcher.withArgs.apply(strategyDispatcher, arguments);
    };
    wrapper.calls = callTracker;

    if (defaultStrategyFn) {
      defaultStrategyFn(wrapper.and);
    }

    return wrapper;
  }

  function SpyStrategyDispatcher(strategyArgs) {
    var baseStrategy = new j$.SpyStrategy(strategyArgs);
    var argsStrategies = new StrategyDict(function() {
      return new j$.SpyStrategy(strategyArgs);
    });

    this.and = baseStrategy;

    this.exec = function(spy, args) {
      var strategy = argsStrategies.get(args);

      if (!strategy) {
        if (argsStrategies.any() && !baseStrategy.isConfigured()) {
          throw new Error(
            "Spy '" +
              strategyArgs.name +
              "' received a call with arguments " +
              j$.pp(Array.prototype.slice.call(args)) +
              ' but all configured strategies specify other arguments.'
          );
        } else {
          strategy = baseStrategy;
        }
      }

      return strategy.exec(spy, args);
    };

    this.withArgs = function() {
      return { and: argsStrategies.getOrCreate(arguments) };
    };
  }

  function StrategyDict(strategyFactory) {
    this.strategies = [];
    this.strategyFactory = strategyFactory;
  }

  StrategyDict.prototype.any = function() {
    return this.strategies.length > 0;
  };

  StrategyDict.prototype.getOrCreate = function(args) {
    var strategy = this.get(args);

    if (!strategy) {
      strategy = this.strategyFactory();
      this.strategies.push({
        args: args,
        strategy: strategy
      });
    }

    return strategy;
  };

  StrategyDict.prototype.get = function(args) {
    var i;

    for (i = 0; i < this.strategies.length; i++) {
      if (j$.matchersUtil.equals(args, this.strategies[i].args)) {
        return this.strategies[i].strategy;
      }
    }
  };

  return Spy;
};

getJasmineRequireObj().SpyFactory = function(j$) {
  function SpyFactory(getCustomStrategies, getDefaultStrategyFn, getPromise) {
    var self = this;

    this.createSpy = function(name, originalFn) {
      return j$.Spy(
        name,
        originalFn,
        getCustomStrategies(),
        getDefaultStrategyFn(),
        getPromise
      );
    };

    this.createSpyObj = function(baseName, methodNames, propertyNames) {
      var baseNameIsCollection =
        j$.isObject_(baseName) || j$.isArray_(baseName);

      if (baseNameIsCollection) {
        propertyNames = methodNames;
        methodNames = baseName;
        baseName = 'unknown';
      }

      var obj = {};
      var spy, descriptor;

      var methods = normalizeKeyValues(methodNames);
      for (var i = 0; i < methods.length; i++) {
        spy = obj[methods[i][0]] = self.createSpy(
          baseName + '.' + methods[i][0]
        );
        if (methods[i].length > 1) {
          spy.and.returnValue(methods[i][1]);
        }
      }

      var properties = normalizeKeyValues(propertyNames);
      for (var i = 0; i < properties.length; i++) {
        descriptor = {
          get: self.createSpy(baseName + '.' + properties[i][0] + '.get'),
          set: self.createSpy(baseName + '.' + properties[i][0] + '.set')
        };
        if (properties[i].length > 1) {
          descriptor.get.and.returnValue(properties[i][1]);
          descriptor.set.and.returnValue(properties[i][1]);
        }
        Object.defineProperty(obj, properties[i][0], descriptor);
      }

      if (methods.length === 0 && properties.length === 0) {
        throw 'createSpyObj requires a non-empty array or object of method names to create spies for';
      }

      return obj;
    };
  }

  function normalizeKeyValues(object) {
    var result = [];
    if (j$.isArray_(object)) {
      for (var i = 0; i < object.length; i++) {
        result.push([object[i]]);
      }
    } else if (j$.isObject_(object)) {
      for (var key in object) {
        if (object.hasOwnProperty(key)) {
          result.push([key, object[key]]);
        }
      }
    }
    return result;
  }

  return SpyFactory;
};

getJasmineRequireObj().SpyRegistry = function(j$) {
  var spyOnMsg = j$.formatErrorMsg('<spyOn>', 'spyOn(<object>, <methodName>)');
  var spyOnPropertyMsg = j$.formatErrorMsg(
    '<spyOnProperty>',
    'spyOnProperty(<object>, <propName>, [accessType])'
  );

  function SpyRegistry(options) {
    options = options || {};
    var global = options.global || j$.getGlobal();
    var createSpy = options.createSpy;
    var currentSpies =
      options.currentSpies ||
      function() {
        return [];
      };

    this.allowRespy = function(allow) {
      this.respy = allow;
    };

    this.spyOn = function(obj, methodName) {
      var getErrorMsg = spyOnMsg;

      if (j$.util.isUndefined(obj) || obj === null) {
        throw new Error(
          getErrorMsg(
            'could not find an object to spy upon for ' + methodName + '()'
          )
        );
      }

      if (j$.util.isUndefined(methodName) || methodName === null) {
        throw new Error(getErrorMsg('No method name supplied'));
      }

      if (j$.util.isUndefined(obj[methodName])) {
        throw new Error(getErrorMsg(methodName + '() method does not exist'));
      }

      if (obj[methodName] && j$.isSpy(obj[methodName])) {
        if (this.respy) {
          return obj[methodName];
        } else {
          throw new Error(
            getErrorMsg(methodName + ' has already been spied upon')
          );
        }
      }

      var descriptor = Object.getOwnPropertyDescriptor(obj, methodName);

      if (descriptor && !(descriptor.writable || descriptor.set)) {
        throw new Error(
          getErrorMsg(methodName + ' is not declared writable or has no setter')
        );
      }

      var originalMethod = obj[methodName],
        spiedMethod = createSpy(methodName, originalMethod),
        restoreStrategy;

      if (
        Object.prototype.hasOwnProperty.call(obj, methodName) ||
        (obj === global && methodName === 'onerror')
      ) {
        restoreStrategy = function() {
          obj[methodName] = originalMethod;
        };
      } else {
        restoreStrategy = function() {
          if (!delete obj[methodName]) {
            obj[methodName] = originalMethod;
          }
        };
      }

      currentSpies().push({
        restoreObjectToOriginalState: restoreStrategy
      });

      obj[methodName] = spiedMethod;

      return spiedMethod;
    };

    this.spyOnProperty = function(obj, propertyName, accessType) {
      var getErrorMsg = spyOnPropertyMsg;

      accessType = accessType || 'get';

      if (j$.util.isUndefined(obj)) {
        throw new Error(
          getErrorMsg(
            'spyOn could not find an object to spy upon for ' +
              propertyName +
              ''
          )
        );
      }

      if (j$.util.isUndefined(propertyName)) {
        throw new Error(getErrorMsg('No property name supplied'));
      }

      var descriptor = j$.util.getPropertyDescriptor(obj, propertyName);

      if (!descriptor) {
        throw new Error(getErrorMsg(propertyName + ' property does not exist'));
      }

      if (!descriptor.configurable) {
        throw new Error(
          getErrorMsg(propertyName + ' is not declared configurable')
        );
      }

      if (!descriptor[accessType]) {
        throw new Error(
          getErrorMsg(
            'Property ' +
              propertyName +
              ' does not have access type ' +
              accessType
          )
        );
      }

      if (j$.isSpy(descriptor[accessType])) {
        if (this.respy) {
          return descriptor[accessType];
        } else {
          throw new Error(
            getErrorMsg(
              propertyName + '#' + accessType + ' has already been spied upon'
            )
          );
        }
      }

      var originalDescriptor = j$.util.clone(descriptor),
        spy = createSpy(propertyName, descriptor[accessType]),
        restoreStrategy;

      if (Object.prototype.hasOwnProperty.call(obj, propertyName)) {
        restoreStrategy = function() {
          Object.defineProperty(obj, propertyName, originalDescriptor);
        };
      } else {
        restoreStrategy = function() {
          delete obj[propertyName];
        };
      }

      currentSpies().push({
        restoreObjectToOriginalState: restoreStrategy
      });

      descriptor[accessType] = spy;

      Object.defineProperty(obj, propertyName, descriptor);

      return spy;
    };

    this.spyOnAllFunctions = function(obj) {
      if (j$.util.isUndefined(obj)) {
        throw new Error(
          'spyOnAllFunctions could not find an object to spy upon'
        );
      }

      var pointer = obj,
        props = [],
        prop,
        descriptor;

      while (pointer) {
        for (prop in pointer) {
          if (
            Object.prototype.hasOwnProperty.call(pointer, prop) &&
            pointer[prop] instanceof Function
          ) {
            descriptor = Object.getOwnPropertyDescriptor(pointer, prop);
            if (
              (descriptor.writable || descriptor.set) &&
              descriptor.configurable
            ) {
              props.push(prop);
            }
          }
        }
        pointer = Object.getPrototypeOf(pointer);
      }

      for (var i = 0; i < props.length; i++) {
        this.spyOn(obj, props[i]);
      }

      return obj;
    };

    this.clearSpies = function() {
      var spies = currentSpies();
      for (var i = spies.length - 1; i >= 0; i--) {
        var spyEntry = spies[i];
        spyEntry.restoreObjectToOriginalState();
      }
    };
  }

  return SpyRegistry;
};

getJasmineRequireObj().SpyStrategy = function(j$) {
  /**
   * @interface SpyStrategy
   */
  function SpyStrategy(options) {
    options = options || {};

    var self = this;

    /**
     * Get the identifying information for the spy.
     * @name SpyStrategy#identity
     * @since 3.0.0
     * @member
     * @type {String}
     */
    this.identity = options.name || 'unknown';
    this.originalFn = options.fn || function() {};
    this.getSpy = options.getSpy || function() {};
    this.plan = this._defaultPlan = function() {};

    var k,
      cs = options.customStrategies || {};
    for (k in cs) {
      if (j$.util.has(cs, k) && !this[k]) {
        this[k] = createCustomPlan(cs[k]);
      }
    }

    var getPromise =
      typeof options.getPromise === 'function'
        ? options.getPromise
        : function() {};

    var requirePromise = function(name) {
      var Promise = getPromise();

      if (!Promise) {
        throw new Error(
          name +
            ' requires global Promise, or `Promise` configured with `jasmine.getEnv().configure()`'
        );
      }

      return Promise;
    };

    /**
     * Tell the spy to return a promise resolving to the specified value when invoked.
     * @name SpyStrategy#resolveTo
     * @since 3.5.0
     * @function
     * @param {*} value The value to return.
     */
    this.resolveTo = function(value) {
      var Promise = requirePromise('resolveTo');
      self.plan = function() {
        return Promise.resolve(value);
      };
      return self.getSpy();
    };

    /**
     * Tell the spy to return a promise rejecting with the specified value when invoked.
     * @name SpyStrategy#rejectWith
     * @since 3.5.0
     * @function
     * @param {*} value The value to return.
     */
    this.rejectWith = function(value) {
      var Promise = requirePromise('rejectWith');

      self.plan = function() {
        return Promise.reject(value);
      };
      return self.getSpy();
    };
  }

  function createCustomPlan(factory) {
    return function() {
      var plan = factory.apply(null, arguments);

      if (!j$.isFunction_(plan)) {
        throw new Error('Spy strategy must return a function');
      }

      this.plan = plan;
      return this.getSpy();
    };
  }

  /**
   * Execute the current spy strategy.
   * @name SpyStrategy#exec
   * @since 2.0.0
   * @function
   */
  SpyStrategy.prototype.exec = function(context, args) {
    return this.plan.apply(context, args);
  };

  /**
   * Tell the spy to call through to the real implementation when invoked.
   * @name SpyStrategy#callThrough
   * @since 2.0.0
   * @function
   */
  SpyStrategy.prototype.callThrough = function() {
    this.plan = this.originalFn;
    return this.getSpy();
  };

  /**
   * Tell the spy to return the value when invoked.
   * @name SpyStrategy#returnValue
   * @since 2.0.0
   * @function
   * @param {*} value The value to return.
   */
  SpyStrategy.prototype.returnValue = function(value) {
    this.plan = function() {
      return value;
    };
    return this.getSpy();
  };

  /**
   * Tell the spy to return one of the specified values (sequentially) each time the spy is invoked.
   * @name SpyStrategy#returnValues
   * @since 2.1.0
   * @function
   * @param {...*} values - Values to be returned on subsequent calls to the spy.
   */
  SpyStrategy.prototype.returnValues = function() {
    var values = Array.prototype.slice.call(arguments);
    this.plan = function() {
      return values.shift();
    };
    return this.getSpy();
  };

  /**
   * Tell the spy to throw an error when invoked.
   * @name SpyStrategy#throwError
   * @since 2.0.0
   * @function
   * @param {Error|String} something Thing to throw
   */
  SpyStrategy.prototype.throwError = function(something) {
    var error = something instanceof Error ? something : new Error(something);
    this.plan = function() {
      throw error;
    };
    return this.getSpy();
  };

  /**
   * Tell the spy to call a fake implementation when invoked.
   * @name SpyStrategy#callFake
   * @since 2.0.0
   * @function
   * @param {Function} fn The function to invoke with the passed parameters.
   */
  SpyStrategy.prototype.callFake = function(fn) {
    if (!(j$.isFunction_(fn) || j$.isAsyncFunction_(fn))) {
      throw new Error(
        'Argument passed to callFake should be a function, got ' + fn
      );
    }
    this.plan = fn;
    return this.getSpy();
  };

  /**
   * Tell the spy to do nothing when invoked. This is the default.
   * @name SpyStrategy#stub
   * @since 2.0.0
   * @function
   */
  SpyStrategy.prototype.stub = function(fn) {
    this.plan = function() {};
    return this.getSpy();
  };

  SpyStrategy.prototype.isConfigured = function() {
    return this.plan !== this._defaultPlan;
  };

  return SpyStrategy;
};

getJasmineRequireObj().StackTrace = function(j$) {
  function StackTrace(error) {
    var lines = error.stack.split('\n').filter(function(line) {
      return line !== '';
    });

    var extractResult = extractMessage(error.message, lines);

    if (extractResult) {
      this.message = extractResult.message;
      lines = extractResult.remainder;
    }

    var parseResult = tryParseFrames(lines);
    this.frames = parseResult.frames;
    this.style = parseResult.style;
  }

  var framePatterns = [
    // PhantomJS on Linux, Node, Chrome, IE, Edge
    // e.g. "   at QueueRunner.run (http://localhost:8888/__jasmine__/jasmine.js:4320:20)"
    // Note that the "function name" can include a surprisingly large set of
    // characters, including angle brackets and square brackets.
    {
      re: /^\s*at ([^\)]+) \(([^\)]+)\)$/,
      fnIx: 1,
      fileLineColIx: 2,
      style: 'v8'
    },

    // NodeJS alternate form, often mixed in with the Chrome style
    // e.g. "  at /some/path:4320:20
    { re: /\s*at (.+)$/, fileLineColIx: 1, style: 'v8' },

    // PhantomJS on OS X, Safari, Firefox
    // e.g. "run@http://localhost:8888/__jasmine__/jasmine.js:4320:27"
    // or "http://localhost:8888/__jasmine__/jasmine.js:4320:27"
    {
      re: /^(([^@\s]+)@)?([^\s]+)$/,
      fnIx: 2,
      fileLineColIx: 3,
      style: 'webkit'
    }
  ];

  // regexes should capture the function name (if any) as group 1
  // and the file, line, and column as group 2.
  function tryParseFrames(lines) {
    var style = null;
    var frames = lines.map(function(line) {
      var convertedLine = first(framePatterns, function(pattern) {
        var overallMatch = line.match(pattern.re),
          fileLineColMatch;
        if (!overallMatch) {
          return null;
        }

        fileLineColMatch = overallMatch[pattern.fileLineColIx].match(
          /^(.*):(\d+):\d+$/
        );
        if (!fileLineColMatch) {
          return null;
        }

        style = style || pattern.style;
        return {
          raw: line,
          file: fileLineColMatch[1],
          line: parseInt(fileLineColMatch[2], 10),
          func: overallMatch[pattern.fnIx]
        };
      });

      return convertedLine || { raw: line };
    });

    return {
      style: style,
      frames: frames
    };
  }

  function first(items, fn) {
    var i, result;

    for (i = 0; i < items.length; i++) {
      result = fn(items[i]);

      if (result) {
        return result;
      }
    }
  }

  function extractMessage(message, stackLines) {
    var len = messagePrefixLength(message, stackLines);

    if (len > 0) {
      return {
        message: stackLines.slice(0, len).join('\n'),
        remainder: stackLines.slice(len)
      };
    }
  }

  function messagePrefixLength(message, stackLines) {
    if (!stackLines[0].match(/^Error/)) {
      return 0;
    }

    var messageLines = message.split('\n');
    var i;

    for (i = 1; i < messageLines.length; i++) {
      if (messageLines[i] !== stackLines[i]) {
        return 0;
      }
    }

    return messageLines.length;
  }

  return StackTrace;
};

getJasmineRequireObj().Suite = function(j$) {
  function Suite(attrs) {
    this.env = attrs.env;
    this.id = attrs.id;
    this.parentSuite = attrs.parentSuite;
    this.description = attrs.description;
    this.expectationFactory = attrs.expectationFactory;
    this.asyncExpectationFactory = attrs.asyncExpectationFactory;
    this.expectationResultFactory = attrs.expectationResultFactory;
    this.throwOnExpectationFailure = !!attrs.throwOnExpectationFailure;

    this.beforeFns = [];
    this.afterFns = [];
    this.beforeAllFns = [];
    this.afterAllFns = [];

    this.timer = attrs.timer || j$.noopTimer;

    this.children = [];

    /**
     * @typedef SuiteResult
     * @property {Int} id - The unique id of this suite.
     * @property {String} description - The description text passed to the {@link describe} that made this suite.
     * @property {String} fullName - The full description including all ancestors of this suite.
     * @property {Expectation[]} failedExpectations - The list of expectations that failed in an {@link afterAll} for this suite.
     * @property {Expectation[]} deprecationWarnings - The list of deprecation warnings that occurred on this suite.
     * @property {String} status - Once the suite has completed, this string represents the pass/fail status of this suite.
     * @property {number} duration - The time in ms for Suite execution, including any before/afterAll, before/afterEach.
     */
    this.result = {
      id: this.id,
      description: this.description,
      fullName: this.getFullName(),
      failedExpectations: [],
      deprecationWarnings: [],
      duration: null
    };
  }

  Suite.prototype.expect = function(actual) {
    return this.expectationFactory(actual, this);
  };

  Suite.prototype.expectAsync = function(actual) {
    return this.asyncExpectationFactory(actual, this);
  };

  Suite.prototype.getFullName = function() {
    var fullName = [];
    for (
      var parentSuite = this;
      parentSuite;
      parentSuite = parentSuite.parentSuite
    ) {
      if (parentSuite.parentSuite) {
        fullName.unshift(parentSuite.description);
      }
    }
    return fullName.join(' ');
  };

  Suite.prototype.pend = function() {
    this.markedPending = true;
  };

  Suite.prototype.beforeEach = function(fn) {
    this.beforeFns.unshift(fn);
  };

  Suite.prototype.beforeAll = function(fn) {
    this.beforeAllFns.push(fn);
  };

  Suite.prototype.afterEach = function(fn) {
    this.afterFns.unshift(fn);
  };

  Suite.prototype.afterAll = function(fn) {
    this.afterAllFns.unshift(fn);
  };

  Suite.prototype.startTimer = function() {
    this.timer.start();
  };

  Suite.prototype.endTimer = function() {
    this.result.duration = this.timer.elapsed();
  };

  function removeFns(queueableFns) {
    for (var i = 0; i < queueableFns.length; i++) {
      queueableFns[i].fn = null;
    }
  }

  Suite.prototype.cleanupBeforeAfter = function() {
    removeFns(this.beforeAllFns);
    removeFns(this.afterAllFns);
    removeFns(this.beforeFns);
    removeFns(this.afterFns);
  };

  Suite.prototype.addChild = function(child) {
    this.children.push(child);
  };

  Suite.prototype.status = function() {
    if (this.markedPending) {
      return 'pending';
    }

    if (this.result.failedExpectations.length > 0) {
      return 'failed';
    } else {
      return 'passed';
    }
  };

  Suite.prototype.canBeReentered = function() {
    return this.beforeAllFns.length === 0 && this.afterAllFns.length === 0;
  };

  Suite.prototype.getResult = function() {
    this.result.status = this.status();
    return this.result;
  };

  Suite.prototype.sharedUserContext = function() {
    if (!this.sharedContext) {
      this.sharedContext = this.parentSuite
        ? this.parentSuite.clonedSharedUserContext()
        : new j$.UserContext();
    }

    return this.sharedContext;
  };

  Suite.prototype.clonedSharedUserContext = function() {
    return j$.UserContext.fromExisting(this.sharedUserContext());
  };

  Suite.prototype.onException = function() {
    if (arguments[0] instanceof j$.errors.ExpectationFailed) {
      return;
    }

    var data = {
      matcherName: '',
      passed: false,
      expected: '',
      actual: '',
      error: arguments[0]
    };
    var failedExpectation = this.expectationResultFactory(data);

    if (!this.parentSuite) {
      failedExpectation.globalErrorType = 'afterAll';
    }

    this.result.failedExpectations.push(failedExpectation);
  };

  Suite.prototype.addExpectationResult = function() {
    if (isFailure(arguments)) {
      var data = arguments[1];
      this.result.failedExpectations.push(this.expectationResultFactory(data));
      if (this.throwOnExpectationFailure) {
        throw new j$.errors.ExpectationFailed();
      }
    }
  };

  Suite.prototype.addDeprecationWarning = function(deprecation) {
    if (typeof deprecation === 'string') {
      deprecation = { message: deprecation };
    }
    this.result.deprecationWarnings.push(
      this.expectationResultFactory(deprecation)
    );
  };

  function isFailure(args) {
    return !args[0];
  }

  return Suite;
};

if (typeof window == void 0 && typeof exports == 'object') {
  /* globals exports */
  exports.Suite = jasmineRequire.Suite;
}

getJasmineRequireObj().Timer = function() {
  var defaultNow = (function(Date) {
    return function() {
      return new Date().getTime();
    };
  })(Date);

  function Timer(options) {
    options = options || {};

    var now = options.now || defaultNow,
      startTime;

    this.start = function() {
      startTime = now();
    };

    this.elapsed = function() {
      return now() - startTime;
    };
  }

  return Timer;
};

getJasmineRequireObj().noopTimer = function() {
  return {
    start: function() {},
    elapsed: function() {
      return 0;
    }
  };
};

getJasmineRequireObj().TreeProcessor = function() {
  function TreeProcessor(attrs) {
    var tree = attrs.tree,
      runnableIds = attrs.runnableIds,
      queueRunnerFactory = attrs.queueRunnerFactory,
      nodeStart = attrs.nodeStart || function() {},
      nodeComplete = attrs.nodeComplete || function() {},
      failSpecWithNoExpectations = !!attrs.failSpecWithNoExpectations,
      orderChildren =
        attrs.orderChildren ||
        function(node) {
          return node.children;
        },
      excludeNode =
        attrs.excludeNode ||
        function(node) {
          return false;
        },
      stats = { valid: true },
      processed = false,
      defaultMin = Infinity,
      defaultMax = 1 - Infinity;

    this.processTree = function() {
      processNode(tree, true);
      processed = true;
      return stats;
    };

    this.execute = function(done) {
      if (!processed) {
        this.processTree();
      }

      if (!stats.valid) {
        throw 'invalid order';
      }

      var childFns = wrapChildren(tree, 0);

      queueRunnerFactory({
        queueableFns: childFns,
        userContext: tree.sharedUserContext(),
        onException: function() {
          tree.onException.apply(tree, arguments);
        },
        onComplete: done
      });
    };

    function runnableIndex(id) {
      for (var i = 0; i < runnableIds.length; i++) {
        if (runnableIds[i] === id) {
          return i;
        }
      }
    }

    function processNode(node, parentExcluded) {
      var executableIndex = runnableIndex(node.id);

      if (executableIndex !== undefined) {
        parentExcluded = false;
      }

      if (!node.children) {
        var excluded = parentExcluded || excludeNode(node);
        stats[node.id] = {
          excluded: excluded,
          willExecute: !excluded && !node.markedPending,
          segments: [
            {
              index: 0,
              owner: node,
              nodes: [node],
              min: startingMin(executableIndex),
              max: startingMax(executableIndex)
            }
          ]
        };
      } else {
        var hasExecutableChild = false;

        var orderedChildren = orderChildren(node);

        for (var i = 0; i < orderedChildren.length; i++) {
          var child = orderedChildren[i];

          processNode(child, parentExcluded);

          if (!stats.valid) {
            return;
          }

          var childStats = stats[child.id];

          hasExecutableChild = hasExecutableChild || childStats.willExecute;
        }

        stats[node.id] = {
          excluded: parentExcluded,
          willExecute: hasExecutableChild
        };

        segmentChildren(node, orderedChildren, stats[node.id], executableIndex);

        if (!node.canBeReentered() && stats[node.id].segments.length > 1) {
          stats = { valid: false };
        }
      }
    }

    function startingMin(executableIndex) {
      return executableIndex === undefined ? defaultMin : executableIndex;
    }

    function startingMax(executableIndex) {
      return executableIndex === undefined ? defaultMax : executableIndex;
    }

    function segmentChildren(
      node,
      orderedChildren,
      nodeStats,
      executableIndex
    ) {
      var currentSegment = {
          index: 0,
          owner: node,
          nodes: [],
          min: startingMin(executableIndex),
          max: startingMax(executableIndex)
        },
        result = [currentSegment],
        lastMax = defaultMax,
        orderedChildSegments = orderChildSegments(orderedChildren);

      function isSegmentBoundary(minIndex) {
        return (
          lastMax !== defaultMax &&
          minIndex !== defaultMin &&
          lastMax < minIndex - 1
        );
      }

      for (var i = 0; i < orderedChildSegments.length; i++) {
        var childSegment = orderedChildSegments[i],
          maxIndex = childSegment.max,
          minIndex = childSegment.min;

        if (isSegmentBoundary(minIndex)) {
          currentSegment = {
            index: result.length,
            owner: node,
            nodes: [],
            min: defaultMin,
            max: defaultMax
          };
          result.push(currentSegment);
        }

        currentSegment.nodes.push(childSegment);
        currentSegment.min = Math.min(currentSegment.min, minIndex);
        currentSegment.max = Math.max(currentSegment.max, maxIndex);
        lastMax = maxIndex;
      }

      nodeStats.segments = result;
    }

    function orderChildSegments(children) {
      var specifiedOrder = [],
        unspecifiedOrder = [];

      for (var i = 0; i < children.length; i++) {
        var child = children[i],
          segments = stats[child.id].segments;

        for (var j = 0; j < segments.length; j++) {
          var seg = segments[j];

          if (seg.min === defaultMin) {
            unspecifiedOrder.push(seg);
          } else {
            specifiedOrder.push(seg);
          }
        }
      }

      specifiedOrder.sort(function(a, b) {
        return a.min - b.min;
      });

      return specifiedOrder.concat(unspecifiedOrder);
    }

    function executeNode(node, segmentNumber) {
      if (node.children) {
        return {
          fn: function(done) {
            var onStart = {
              fn: function(next) {
                nodeStart(node, next);
              }
            };

            queueRunnerFactory({
              onComplete: function() {
                var args = Array.prototype.slice.call(arguments, [0]);
                node.cleanupBeforeAfter();
                nodeComplete(node, node.getResult(), function() {
                  done.apply(undefined, args);
                });
              },
              queueableFns: [onStart].concat(wrapChildren(node, segmentNumber)),
              userContext: node.sharedUserContext(),
              onException: function() {
                node.onException.apply(node, arguments);
              }
            });
          }
        };
      } else {
        return {
          fn: function(done) {
            node.execute(
              done,
              stats[node.id].excluded,
              failSpecWithNoExpectations
            );
          }
        };
      }
    }

    function wrapChildren(node, segmentNumber) {
      var result = [],
        segmentChildren = stats[node.id].segments[segmentNumber].nodes;

      for (var i = 0; i < segmentChildren.length; i++) {
        result.push(
          executeNode(segmentChildren[i].owner, segmentChildren[i].index)
        );
      }

      if (!stats[node.id].willExecute) {
        return result;
      }

      return node.beforeAllFns.concat(result).concat(node.afterAllFns);
    }
  }

  return TreeProcessor;
};

getJasmineRequireObj().UserContext = function(j$) {
  function UserContext() {}

  UserContext.fromExisting = function(oldContext) {
    var context = new UserContext();

    for (var prop in oldContext) {
      if (oldContext.hasOwnProperty(prop)) {
        context[prop] = oldContext[prop];
      }
    }

    return context;
  };

  return UserContext;
};

getJasmineRequireObj().version = function() {
  return '3.5.0';
};
