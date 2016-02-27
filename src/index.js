import {utils} from 'js-data'
import rethinkdbdash from 'rethinkdbdash'
import underscore from 'mout/string/underscore'

const {
  addHiddenPropsToTarget,
  fillIn,
  forEachRelation,
  forOwn,
  get,
  isArray,
  isObject,
  isString,
  isUndefined,
  plainCopy,
  resolve
} = utils

const reserved = [
  'orderBy',
  'sort',
  'limit',
  'offset',
  'skip',
  'where'
]

const unique = function (array) {
  const seen = {}
  const final = []
  array.forEach(function (item) {
    if (item in seen) {
      return
    }
    final.push(item)
    seen[item] = 0
  })
  return final
}

const noop = function (...args) {
  const self = this
  const opts = args[args.length - 1]
  self.dbg(opts.op, ...args)
  return resolve()
}

const noop2 = function (...args) {
  const self = this
  const opts = args[args.length - 2]
  self.dbg(opts.op, ...args)
  return resolve()
}

const DEFAULTS = {
  /**
   * RethinkDB authorization key.
   *
   * @name RethinkDBAdapter#authKey
   * @type {string}
   */
  authKey: '',

  /**
   * Buffer size for connection pool.
   *
   * @name RethinkDBAdapter#bufferSize
   * @type {number}
   * @default 10
   */
  bufferSize: 10,

  /**
   * Default database.
   *
   * @name RethinkDBAdapter#db
   * @type {string}
   * @default "test"
   */
  db: 'test',

  /**
   * Whether to log debugging information.
   *
   * @name RethinkDBAdapter#debug
   * @type {boolean}
   * @default false
   */
  debug: false,

  /**
   * RethinkDB host.
   *
   * @name RethinkDBAdapter#host
   * @type {string}
   * @default "localhost"
   */
  host: 'localhost',

  /**
   * Minimum connections in pool.
   *
   * @name RethinkDBAdapter#min
   * @type {number}
   * @default 10
   */
  min: 10,

  /**
   * Maximum connections in pool.
   *
   * @name RethinkDBAdapter#max
   * @type {number}
   * @default 50
   */
  max: 50,

  /**
   * RethinkDB port.
   *
   * @name RethinkDBAdapter#port
   * @type {number}
   * @default 10
   */
  port: 28015,

  /**
   * Whether to return a more detailed response object.
   *
   * @name RethinkDBAdapter#raw
   * @type {boolean}
   * @default false
   */
  raw: false
}

const INSERT_OPTS_DEFAULTS = {}
const UPDATE_OPTS_DEFAULTS = {}
const DELETE_OPTS_DEFAULTS = {}
const RUN_OPTS_DEFAULTS = {}

const equal = function (r, row, field, value) {
  return row(field).default(null).eq(value)
}

const notEqual = function (r, row, field, value) {
  return row(field).default(null).ne(value)
}

/**
 * Default predicate functions for the filtering operators.
 *
 * @name RethinkDBAdapter.OPERATORS
 * @property {Function} == Equality operator.
 * @property {Function} != Inequality operator.
 * @property {Function} > "Greater than" operator.
 * @property {Function} >= "Greater than or equal to" operator.
 * @property {Function} < "Less than" operator.
 * @property {Function} <= "Less than or equal to" operator.
 * @property {Function} isectEmpty Operator to test that the intersection
 * between two arrays is empty.
 * @property {Function} isectNotEmpty Operator to test that the intersection
 * between two arrays is NOT empty.
 * @property {Function} in Operator to test whether a value is found in the
 * provided array.
 * @property {Function} notIn Operator to test whether a value is NOT found in
 * the provided array.
 * @property {Function} contains Operator to test whether an array contains the
 * provided value.
 * @property {Function} notContains Operator to test whether an array does NOT
 * contain the provided value.
 */
const OPERATORS = {
  '==': equal,
  '===': equal,
  '!=': notEqual,
  '!==': notEqual,
  '>': function (r, row, field, value) {
    return row(field).default(null).gt(value)
  },
  '>=': function (r, row, field, value) {
    return row(field).default(null).ge(value)
  },
  '<': function (r, row, field, value) {
    return row(field).default(null).lt(value)
  },
  '<=': function (r, row, field, value) {
    return row(field).default(null).le(value)
  },
  'isectEmpty': function (r, row, field, value) {
    return row(field).default([]).setIntersection(r.expr(value).default([])).count().eq(0)
  },
  'isectNotEmpty': function (r, row, field, value) {
    return row(field).default([]).setIntersection(r.expr(value).default([])).count().ne(0)
  },
  'in': function (r, row, field, value) {
    return r.expr(value).default(r.expr([])).contains(row(field).default(null))
  },
  'notIn': function (r, row, field, value) {
    return r.expr(value).default(r.expr([])).contains(row(field).default(null)).not()
  },
  'contains': function (r, row, field, value) {
    return row(field).default([]).contains(value)
  },
  'notContains': function (r, row, field, value) {
    return row(field).default([]).contains(value).not()
  }
}

/**
 * RethinkDBAdapter class.
 *
 * @example
 * // Use Container instead of DataStore on the server
 * import {Container} from 'js-data'
 * import RethinkdbDBAdapter from 'js-data-rethinkdb'
 *
 * // Create a store to hold your Mappers
 * const store = new Container()
 *
 * // Create an instance of RethinkdbDBAdapter with default settings
 * const adapter = new RethinkdbDBAdapter()
 *
 * // Mappers in "store" will use the RethinkDB adapter by default
 * store.registerAdapter('rethinkdb', adapter, { default: true })
 *
 * // Create a Mapper that maps to a "user" table
 * store.defineMapper('user')
 *
 * @class RethinkDBAdapter
 * @param {Object} [opts] Configuration opts.
 * @param {string} [opts.authKey=""] RethinkDB authorization key.
 * @param {number} [opts.bufferSize=10] Buffer size for connection pool.
 * @param {string} [opts.db="test"] Default database.
 * @param {boolean} [opts.debug=false] Whether to log debugging information.
 * @param {string} [opts.host="localhost"] RethinkDB host.
 * @param {number} [opts.max=50] Maximum connections in pool.
 * @param {number} [opts.min=10] Minimum connections in pool.
 * @param {Object} [opts.operators] Override the default predicate functions for
 * specified operators.
 * @param {number} [opts.port=28015] RethinkDB port.
 * @param {boolean} [opts.raw=false] Whether to return a more detailed response object.
 */
export default function RethinkDBAdapter (opts) {
  const self = this
  opts || (opts = {})
  fillIn(opts, DEFAULTS)
  fillIn(self, opts)

  /**
   * Default options to pass to r#insert.
   *
   * @name RethinkDBAdapter#insertOpts
   * @type {Object}
   * @default {}
   */
  self.insertOpts || (self.insertOpts = {})
  fillIn(self.insertOpts, INSERT_OPTS_DEFAULTS)

  /**
   * Default options to pass to r#update.
   *
   * @name RethinkDBAdapter#updateOpts
   * @type {Object}
   * @default {}
   */
  self.updateOpts || (self.updateOpts = {})
  fillIn(self.updateOpts, UPDATE_OPTS_DEFAULTS)

  /**
   * Default options to pass to r#delete.
   *
   * @name RethinkDBAdapter#deleteOpts
   * @type {Object}
   * @default {}
   */
  self.deleteOpts || (self.deleteOpts = {})
  fillIn(self.deleteOpts, DELETE_OPTS_DEFAULTS)

  /**
   * Default options to pass to r#run.
   *
   * @name RethinkDBAdapter#runOpts
   * @type {Object}
   * @default {}
   */
  self.runOpts || (self.runOpts = {})
  fillIn(self.runOpts, RUN_OPTS_DEFAULTS)

  /**
   * Override the default predicate functions for specified operators.
   *
   * @name RethinkDBAdapter#operators
   * @type {Object}
   * @default {}
   */
  self.operators || (self.operators = {})

  /**
   * The rethinkdbdash instance used by this adapter. Use this directly when you
   * need to write custom queries.
   *
   * @name RethinkDBAdapter#r
   * @type {Object}
   */
  self.r = rethinkdbdash(opts)
  self.databases = {}
  self.tables = {}
  self.indices = {}
}

addHiddenPropsToTarget(RethinkDBAdapter.prototype, {
  _handleErrors (cursor) {
    if (cursor && cursor.errors > 0) {
      if (cursor.first_error) {
        throw new Error(cursor.first_error)
      }
      throw new Error('Unknown RethinkDB Error')
    }
  },
  /**
   * @name RethinkDBAdapter#afterCreate
   * @method
   */
  afterCreate: noop2,

  /**
   * @name RethinkDBAdapter#afterCreateMany
   * @method
   */
  afterCreateMany: noop2,

  /**
   * @name RethinkDBAdapter#afterDestroy
   * @method
   */
  afterDestroy: noop2,

  /**
   * @name RethinkDBAdapter#afterDestroyAll
   * @method
   */
  afterDestroyAll: noop2,

  /**
   * @name RethinkDBAdapter#afterFind
   * @method
   */
  afterFind: noop2,

  /**
   * @name RethinkDBAdapter#afterFindAll
   * @method
   */
  afterFindAll: noop2,

  /**
   * @name RethinkDBAdapter#afterUpdate
   * @method
   */
  afterUpdate: noop2,

  /**
   * @name RethinkDBAdapter#afterUpdateAll
   * @method
   */
  afterUpdateAll: noop2,

  /**
   * @name RethinkDBAdapter#afterUpdateMany
   * @method
   */
  afterUpdateMany: noop2,

  /**
   * @name RethinkDBAdapter#beforeCreate
   * @method
   */
  beforeCreate: noop,

  /**
   * @name RethinkDBAdapter#beforeCreateMany
   * @method
   */
  beforeCreateMany: noop,

  /**
   * @name RethinkDBAdapter#beforeDestroy
   * @method
   */
  beforeDestroy: noop,

  /**
   * @name RethinkDBAdapter#beforeDestroyAll
   * @method
   */
  beforeDestroyAll: noop,

  /**
   * @name RethinkDBAdapter#beforeFind
   * @method
   */
  beforeFind: noop,

  /**
   * @name RethinkDBAdapter#beforeFindAll
   * @method
   */
  beforeFindAll: noop,

  /**
   * @name RethinkDBAdapter#beforeUpdate
   * @method
   */
  beforeUpdate: noop,

  /**
   * @name RethinkDBAdapter#beforeUpdateAll
   * @method
   */
  beforeUpdateAll: noop,

  /**
   * @name RethinkDBAdapter#beforeUpdateMany
   * @method
   */
  beforeUpdateMany: noop,

  /**
   * @name RethinkDBAdapter#dbg
   * @method
   */
  dbg (...args) {
    this.log('debug', ...args)
  },

  selectDb (opts) {
    return this.r.db(isUndefined(opts.db) ? this.db : opts.db)
  },

  selectTable (mapper, opts) {
    return this.selectDb(opts).table(mapper.table || underscore(mapper.name))
  },

  /**
   * Apply the specified selection query to the provided RQL sequence.
   *
   * @name RethinkDBAdapter#filterSequence
   * @method
   * @param {Object} mapper The mapper.
   * @param {Object} [query] Selection query.
   * @param {Object} [query.where] Filtering criteria.
   * @param {string|Array} [query.orderBy] Sorting criteria.
   * @param {string|Array} [query.sort] Same as `query.sort`.
   * @param {number} [query.limit] Limit results.
   * @param {number} [query.skip] Offset results.
   * @param {number} [query.offset] Same as `query.skip`.
   * @param {Object} [opts] Configuration options.
   * @param {Object} [opts.operators] Override the default predicate functions
   * for specified operators.
   */
  filterSequence (sequence, query, opts) {
    const self = this
    const r = self.r

    query = plainCopy(query || {})
    opts || (opts = {})
    opts.operators || (opts.operators = {})
    query.where || (query.where = {})
    query.orderBy || (query.orderBy = query.sort)
    query.orderBy || (query.orderBy = [])
    query.skip || (query.skip = query.offset)

    // Transform non-keyword properties to "where" clause configuration
    forOwn(query, function (config, keyword) {
      if (reserved.indexOf(keyword) === -1) {
        if (isObject(config)) {
          query.where[keyword] = config
        } else {
          query.where[keyword] = {
            '==': config
          }
        }
        delete query[keyword]
      }
    })

    let rql = sequence

    // Filter
    if (Object.keys(query.where).length !== 0) {
      // Filter sequence using filter function
      rql = rql.filter(function (row) {
        let subQuery
        // Apply filter for each field
        forOwn(query.where, function (criteria, field) {
          if (!isObject(criteria)) {
            criteria = { '==': criteria }
          }
          // Apply filter for each operator
          forOwn(criteria, function (value, operator) {
            let isOr = false
            if (operator && operator[0] === '|') {
              operator = operator.substr(1)
              isOr = true
            }
            let predicateFn = self.getOperator(operator, opts)
            if (predicateFn) {
              const predicateResult = predicateFn(r, row, field, value)
              if (isOr) {
                subQuery = subQuery ? subQuery.or(predicateResult) : predicateResult
              } else {
                subQuery = subQuery ? subQuery.and(predicateResult) : predicateResult
              }
            }
          })
        })
        return subQuery || true
      })
    }

    // Sort
    if (query.orderBy) {
      if (isString(query.orderBy)) {
        query.orderBy = [
          [query.orderBy, 'asc']
        ]
      }
      for (var i = 0; i < query.orderBy.length; i++) {
        if (isString(query.orderBy[i])) {
          query.orderBy[i] = [query.orderBy[i], 'asc']
        }
        rql = (query.orderBy[i][1] || '').toUpperCase() === 'DESC' ? rql.orderBy(r.desc(query.orderBy[i][0])) : rql.orderBy(query.orderBy[i][0])
      }
    }

    // Offset
    if (query.skip) {
      rql = rql.skip(+query.skip)
    }

    // Limit
    if (query.limit) {
      rql = rql.limit(+query.limit)
    }

    return rql
  },

  waitForDb (opts) {
    const self = this
    opts || (opts = {})
    const db = isUndefined(opts.db) ? self.db : opts.db
    if (!self.databases[db]) {
      self.databases[db] = self.r.branch(
        self.r.dbList().contains(db),
        true,
        self.r.dbCreate(db)
      ).run()
    }
    return self.databases[db]
  },

  /**
   * Create a new record.
   *
   * @name RethinkDBAdapter#create
   * @method
   * @param {Object} mapper The mapper.
   * @param {Object} props The record to be created.
   * @param {Object} [opts] Configuration options.
   * @param {Object} [opts.insertOpts] Options to pass to r#insert.
   * @param {boolean} [opts.raw=false] Whether to return a more detailed
   * response object.
   * @param {Object} [opts.runOpts] Options to pass to r#run.
   * @return {Promise}
   */
  create (mapper, props, opts) {
    const self = this
    let op
    props || (props = {})
    opts || (opts = {})

    return self.waitForTable(mapper, opts).then(function () {
      // beforeCreate lifecycle hook
      op = opts.op = 'beforeCreate'
      return resolve(self[op](mapper, props, opts))
    }).then(function (_props) {
      // Allow for re-assignment from lifecycle hook
      _props = isUndefined(_props) ? props : _props
      const insertOpts = self.getOpt('insertOpts', opts)
      insertOpts.returnChanges = true
      return self.selectTable(mapper, opts).insert(_props, insertOpts).run(self.getOpt('runOpts', opts))
    }).then(function (cursor) {
      self._handleErrors(cursor)
      let record
      if (cursor && cursor.changes && cursor.changes.length && cursor.changes[0].new_val) {
        record = cursor.changes[0].new_val
      }
      // afterCreate lifecycle hook
      op = opts.op = 'afterCreate'
      return self[op](mapper, props, opts, record).then(function (_record) {
        // Allow for re-assignment from lifecycle hook
        record = isUndefined(_record) ? record : _record
        const result = {}
        fillIn(result, cursor)
        result.data = record
        result.created = record ? 1 : 0
        return self.getOpt('raw', opts) ? result : result.data
      })
    })
  },

  /**
   * Create multiple records in a single batch.
   *
   * @name RethinkDBAdapter#createMany
   * @method
   * @param {Object} mapper The mapper.
   * @param {Object} props The records to be created.
   * @param {Object} [opts] Configuration options.
   * @param {Object} [opts.insertOpts] Options to pass to r#insert.
   * @param {boolean} [opts.raw=false] Whether to return a more detailed
   * response object.
   * @param {Object} [opts.runOpts] Options to pass to r#run.
   * @return {Promise}
   */
  createMany (mapper, props, opts) {
    const self = this
    let op
    props || (props = {})
    opts || (opts = {})

    return self.waitForTable(mapper, opts).then(function () {
      // beforeCreateMany lifecycle hook
      op = opts.op = 'beforeCreateMany'
      return resolve(self[op](mapper, props, opts))
    }).then(function (_props) {
      // Allow for re-assignment from lifecycle hook
      _props = isUndefined(_props) ? props : _props
      const insertOpts = self.getOpt('insertOpts', opts)
      insertOpts.returnChanges = true
      return self.selectTable(mapper, opts).insert(_props, insertOpts).run(self.getOpt('runOpts', opts))
    }).then(function (cursor) {
      self._handleErrors(cursor)
      let records = []
      if (cursor && cursor.changes && cursor.changes.length && cursor.changes) {
        records = cursor.changes.map(function (change) {
          return change.new_val
        })
      }
      // afterCreateMany lifecycle hook
      op = opts.op = 'afterCreateMany'
      return self[op](mapper, props, opts, records).then(function (_records) {
        // Allow for re-assignment from lifecycle hook
        records = isUndefined(_records) ? records : _records
        const result = {}
        fillIn(result, cursor)
        result.data = records
        result.created = records.length
        return self.getOpt('raw', opts) ? result : result.data
      })
    })
  },

  /**
   * Destroy the record with the given primary key.
   *
   * @name RethinkDBAdapter#destroy
   * @method
   * @param {Object} mapper The mapper.
   * @param {(string|number)} id Primary key of the record to destroy.
   * @param {Object} [opts] Configuration options.
   * @param {Object} [opts.deleteOpts] Options to pass to r#delete.
   * @param {boolean} [opts.raw=false] Whether to return a more detailed
   * response object.
   * @param {Object} [opts.runOpts] Options to pass to r#run.
   * @return {Promise}
   */
  destroy (mapper, id, opts) {
    const self = this
    let op
    opts || (opts = {})

    return self.waitForTable(mapper, opts).then(function () {
      // beforeDestroy lifecycle hook
      op = opts.op = 'beforeDestroy'
      return resolve(self[op](mapper, id, opts))
    }).then(function () {
      op = opts.op = 'destroy'
      self.dbg(op, id, opts)
      return self.selectTable(mapper, opts).get(id).delete(self.getOpt('deleteOpts', opts)).run(self.getOpt('runOpts', opts))
    }).then(function (cursor) {
      // afterDestroy lifecycle hook
      op = opts.op = 'afterDestroy'
      return resolve(self[op](mapper, id, opts, cursor)).then(function (_cursor) {
        // Allow for re-assignment from lifecycle hook
        return isUndefined(_cursor) ? cursor : _cursor
      })
    }).then(function (cursor) {
      return self.getOpt('raw', opts) ? cursor : undefined
    })
  },

  /**
   * Destroy the records that match the selection query.
   *
   * @name RethinkDBAdapter#destroyAll
   * @method
   * @param {Object} mapper the mapper.
   * @param {Object} [query] Selection query.
   * @param {Object} [query.where] Filtering criteria.
   * @param {string|Array} [query.orderBy] Sorting criteria.
   * @param {string|Array} [query.sort] Same as `query.sort`.
   * @param {number} [query.limit] Limit results.
   * @param {number} [query.skip] Offset results.
   * @param {number} [query.offset] Same as `query.skip`.
   * @param {Object} [opts] Configuration options.
   * @param {Object} [opts.deleteOpts] Options to pass to r#delete.
   * @param {Object} [opts.operators] Override the default predicate functions
   * for specified operators.
   * @param {boolean} [opts.raw=false] Whether to return a more detailed
   * response object.
   * @param {Object} [opts.runOpts] Options to pass to r#run.
   * @return {Promise}
   */
  destroyAll (mapper, query, opts) {
    const self = this
    let op
    query || (query = {})
    opts || (opts = {})

    return self.waitForTable(mapper, opts).then(function () {
      // beforeDestroyAll lifecycle hook
      op = opts.op = 'beforeDestroyAll'
      return resolve(self[op](mapper, query, opts))
    }).then(function () {
      op = opts.op = 'destroyAll'
      self.dbg(op, query, opts)
      return self
        .filterSequence(self.selectTable(mapper, opts), query)
        .delete(self.getOpt('deleteOpts', opts))
        .run(self.getOpt('runOpts', opts))
    }).then(function (cursor) {
      // afterDestroyAll lifecycle hook
      op = opts.op = 'afterDestroyAll'
      return resolve(self[op](mapper, query, opts, cursor)).then(function (_cursor) {
        // Allow for re-assignment from lifecycle hook
        return isUndefined(_cursor) ? cursor : _cursor
      })
    }).then(function (cursor) {
      return self.getOpt('raw', opts) ? cursor : undefined
    })
  },

  /**
   * Return the foreignKey from the given record for the provided relationship.
   *
   * There may be reasons why you may want to override this method, like when
   * the id of the parent doesn't exactly match up to the key on the child.
   *
   * @name RethinkDBAdapter#makeHasManyForeignKey
   * @method
   * @return {*}
   */
  makeHasManyForeignKey (mapper, def, record) {
    return def.getForeignKey(record)
  },

  /**
   * Load a hasMany relationship.
   *
   * @name RethinkDBAdapter#loadHasMany
   * @method
   * @return {Promise}
   */
  loadHasMany (mapper, def, records, __opts) {
    const self = this
    let singular = false

    if (isObject(records) && !isArray(records)) {
      singular = true
      records = [records]
    }
    const IDs = records.map(function (record) {
      return self.makeHasManyForeignKey(mapper, def, record)
    })
    const query = {}
    const criteria = query[def.foreignKey] = {}
    if (singular) {
      // more efficient query when we only have one record
      criteria['=='] = IDs[0]
    } else {
      criteria['in'] = IDs.filter(function (id) {
        return id
      })
    }
    return self.findAll(def.getRelation(), query, __opts).then(function (relatedItems) {
      records.forEach(function (record) {
        let attached = []
        // avoid unneccesary iteration when we only have one record
        if (singular) {
          attached = relatedItems
        } else {
          relatedItems.forEach(function (relatedItem) {
            if (get(relatedItem, def.foreignKey) === record[mapper.idAttribute]) {
              attached.push(relatedItem)
            }
          })
        }
        def.setLocalField(record, attached)
      })
    })
  },

  /**
   * Load a hasOne relationship.
   *
   * @name RethinkDBAdapter#loadHasOne
   * @method
   * @return {Promise}
   */
  loadHasOne (mapper, def, records, __opts) {
    if (isObject(records) && !isArray(records)) {
      records = [records]
    }
    return this.loadHasMany(mapper, def, records, __opts).then(function () {
      records.forEach(function (record) {
        const relatedData = def.getLocalField(record)
        if (isArray(relatedData) && relatedData.length) {
          def.setLocalField(record, relatedData[0])
        }
      })
    })
  },

  /**
   * Return the foreignKey from the given record for the provided relationship.
   *
   * @name RethinkDBAdapter#makeBelongsToForeignKey
   * @method
   * @return {*}
   */
  makeBelongsToForeignKey (mapper, def, record) {
    return def.getForeignKey(record)
  },

  /**
   * Load a belongsTo relationship.
   *
   * @name RethinkDBAdapter#loadBelongsTo
   * @method
   * @return {Promise}
   */
  loadBelongsTo (mapper, def, records, __opts) {
    const self = this
    const relationDef = def.getRelation()

    if (isObject(records) && !isArray(records)) {
      const record = records
      return self.find(relationDef, self.makeBelongsToForeignKey(mapper, def, record), __opts).then(function (relatedItem) {
        def.setLocalField(record, relatedItem)
      })
    } else {
      const keys = records.map(function (record) {
        return self.makeBelongsToForeignKey(mapper, def, record)
      }).filter(function (key) {
        return key
      })
      return self.findAll(relationDef, {
        where: {
          [relationDef.idAttribute]: {
            'in': keys
          }
        }
      }, __opts).then(function (relatedItems) {
        records.forEach(function (record) {
          relatedItems.forEach(function (relatedItem) {
            if (relatedItem[relationDef.idAttribute] === record[def.foreignKey]) {
              def.setLocalField(record, relatedItem)
            }
          })
        })
      })
    }
  },

  /**
   * Retrieve the record with the given primary key.
   *
   * @name RethinkDBAdapter#find
   * @method
   * @param {Object} mapper The mapper.
   * @param {(string|number)} id Primary key of the record to retrieve.
   * @param {Object} [opts] Configuration options.
   * @param {boolean} [opts.raw=false] Whether to return a more detailed
   * response object.
   * @param {Object} [opts.runOpts] Options to pass to r#run.
   * @param {string[]} [opts.with=[]] Relations to eager load.
   * @return {Promise}
   */
  find (mapper, id, opts) {
    const self = this
    let record, op
    opts || (opts = {})
    opts.with || (opts.with = [])

    const relationList = mapper.relationList || []
    let tasks = [self.waitForTable(mapper, opts)]

    relationList.forEach(function (def) {
      const relationName = def.relation
      const relationDef = def.getRelation()
      if (!opts.with || opts.with.indexOf(relationName) === -1) {
        return
      }
      if (def.foreignKey && def.type !== 'belongsTo') {
        if (def.type === 'belongsTo') {
          tasks.push(self.waitForIndex(mapper.table || underscore(mapper.name), def.foreignKey, opts))
        } else {
          tasks.push(self.waitForIndex(relationDef.table || underscore(relationDef.name), def.foreignKey, opts))
        }
      }
    })
    return Promise.all(tasks).then(function () {
      // beforeFind lifecycle hook
      op = opts.op = 'beforeFind'
      return resolve(self[op](mapper, id, opts))
    }).then(function () {
      op = opts.op = 'find'
      self.dbg(op, id, opts)
      return self.selectTable(mapper, opts).get(id).run(self.getOpt('runOpts', opts))
    }).then(function (_record) {
      if (!_record) {
        return
      }
      record = _record
      const tasks = []

      forEachRelation(mapper, opts, function (def, __opts) {
        const relatedMapper = def.getRelation()
        let task

        if (def.foreignKey && (def.type === 'hasOne' || def.type === 'hasMany')) {
          if (def.type === 'hasOne') {
            task = self.loadHasOne(mapper, def, record, __opts)
          } else {
            task = self.loadHasMany(mapper, def, record, __opts)
          }
        } else if (def.type === 'hasMany' && def.localKeys) {
          let localKeys = []
          let itemKeys = get(record, def.localKeys) || []
          itemKeys = isArray(itemKeys) ? itemKeys : Object.keys(itemKeys)
          localKeys = localKeys.concat(itemKeys)
          task = self.findAll(relatedMapper, {
            where: {
              [relatedMapper.idAttribute]: {
                'in': unique(localKeys).filter(function (x) { return x })
              }
            }
          }, __opts).then(function (relatedItems) {
            def.setLocalField(record, relatedItems)
          })
        } else if (def.type === 'hasMany' && def.foreignKeys) {
          task = self.findAll(relatedMapper, {
            where: {
              [def.foreignKeys]: {
                'contains': get(record, mapper.idAttribute)
              }
            }
          }, __opts).then(function (relatedItems) {
            def.setLocalField(record, relatedItems)
          })
        } else if (def.type === 'belongsTo') {
          task = self.loadBelongsTo(mapper, def, record, __opts)
        }
        if (task) {
          tasks.push(task)
        }
      })

      return Promise.all(tasks)
    }).then(function () {
      // afterFind lifecycle hook
      op = opts.op = 'afterFind'
      return resolve(self[op](mapper, id, opts, record)).then(function (_record) {
        // Allow for re-assignment from lifecycle hook
        record = isUndefined(_record) ? record : _record
        return self.getOpt('raw', opts) ? {
          data: record,
          found: record ? 1 : 0
        } : record
      })
    })
  },

  /**
   * Retrieve the records that match the selection query.
   *
   * @name RethinkDBAdapter#findAll
   * @method
   * @param {Object} mapper The mapper.
   * @param {Object} [query] Selection query.
   * @param {Object} [query.where] Filtering criteria.
   * @param {string|Array} [query.orderBy] Sorting criteria.
   * @param {string|Array} [query.sort] Same as `query.sort`.
   * @param {number} [query.limit] Limit results.
   * @param {number} [query.skip] Offset results.
   * @param {number} [query.offset] Same as `query.skip`.
   * @param {Object} [opts] Configuration options.
   * @param {Object} [opts.operators] Override the default predicate functions
   * for specified operators.
   * @param {boolean} [opts.raw=false] Whether to return a more detailed
   * response object.
   * @param {Object} [opts.runOpts] Options to pass to r#run.
   * @param {string[]} [opts.with=[]] Relations to eager load.
   * @return {Promise}
   */
  findAll (mapper, query, opts) {
    const self = this
    opts || (opts = {})
    opts.with || (opts.with = [])

    let records = []
    let op
    const relationList = mapper.relationList || []
    let tasks = [self.waitForTable(mapper, opts)]

    relationList.forEach(function (def) {
      const relationName = def.relation
      const relationDef = def.getRelation()
      if (!opts.with || opts.with.indexOf(relationName) === -1) {
        return
      }
      if (def.foreignKey && def.type !== 'belongsTo') {
        if (def.type === 'belongsTo') {
          tasks.push(self.waitForIndex(mapper.table || underscore(mapper.name), def.foreignKey, opts))
        } else {
          tasks.push(self.waitForIndex(relationDef.table || underscore(relationDef.name), def.foreignKey, opts))
        }
      }
    })
    return Promise.all(tasks).then(function () {
      // beforeFindAll lifecycle hook
      op = opts.op = 'beforeFindAll'
      return resolve(self[op](mapper, query, opts))
    }).then(function () {
      op = opts.op = 'findAll'
      self.dbg(op, query, opts)
      return self.filterSequence(self.selectTable(mapper, opts), query).run(self.getOpt('runOpts', opts))
    }).then(function (_records) {
      records = _records
      const tasks = []
      forEachRelation(mapper, opts, function (def, __opts) {
        const relatedMapper = def.getRelation()
        const idAttribute = mapper.idAttribute
        let task
        if (def.foreignKey && (def.type === 'hasOne' || def.type === 'hasMany')) {
          if (def.type === 'hasMany') {
            task = self.loadHasMany(mapper, def, records, __opts)
          } else {
            task = self.loadHasOne(mapper, def, records, __opts)
          }
        } else if (def.type === 'hasMany' && def.localKeys) {
          let localKeys = []
          records.forEach(function (item) {
            let itemKeys = item[def.localKeys] || []
            itemKeys = isArray(itemKeys) ? itemKeys : Object.keys(itemKeys)
            localKeys = localKeys.concat(itemKeys)
          })
          task = self.findAll(relatedMapper, {
            where: {
              [relatedMapper.idAttribute]: {
                'in': unique(localKeys).filter(function (x) { return x })
              }
            }
          }, __opts).then(function (relatedItems) {
            records.forEach(function (item) {
              let attached = []
              let itemKeys = get(item, def.localKeys) || []
              itemKeys = isArray(itemKeys) ? itemKeys : Object.keys(itemKeys)
              relatedItems.forEach(function (relatedItem) {
                if (itemKeys && itemKeys.indexOf(relatedItem[relatedMapper.idAttribute]) !== -1) {
                  attached.push(relatedItem)
                }
              })
              def.setLocalField(item, attached)
            })
            return relatedItems
          })
        } else if (def.type === 'hasMany' && def.foreignKeys) {
          task = self.findAll(relatedMapper, {
            where: {
              [def.foreignKeys]: {
                'isectNotEmpty': records.map(function (record) {
                  return get(record, idAttribute)
                })
              }
            }
          }, __opts).then(function (relatedItems) {
            const foreignKeysField = def.foreignKeys
            records.forEach(function (record) {
              const _relatedItems = []
              const id = get(record, idAttribute)
              relatedItems.forEach(function (relatedItem) {
                const foreignKeys = get(relatedItems, foreignKeysField) || []
                if (foreignKeys.indexOf(id) !== -1) {
                  _relatedItems.push(relatedItem)
                }
              })
              def.setLocalField(record, _relatedItems)
            })
          })
        } else if (def.type === 'belongsTo') {
          task = self.loadBelongsTo(mapper, def, records, __opts)
        }
        if (task) {
          tasks.push(task)
        }
      })
      return Promise.all(tasks)
    }).then(function () {
      // afterFindAll lifecycle hook
      op = opts.op = 'afterFindAll'
      return resolve(self[op](mapper, query, opts, records)).then(function (_records) {
        // Allow for re-assignment from lifecycle hook
        records = isUndefined(_records) ? records : _records
        return self.getOpt('raw', opts) ? {
          data: records,
          found: records.length
        } : records
      })
    })
  },

  /**
   * Resolve the predicate function for the specified operator based on the
   * given options and this adapter's settings.
   *
   * @name RethinkDBAdapter#getOperator
   * @method
   * @param {string} operator The name of the operator.
   * @param {Object} [opts] Configuration options.
   * @param {Object} [opts.operators] Override the default predicate functions
   * for specified operators.
   * @return {*} The predicate function for the specified operator.
   */
  getOperator (operator, opts) {
    opts || (opts = {})
    opts.operators || (opts.operators = {})
    let ownOps = this.operators || {}
    return isUndefined(opts.operators[operator]) ? ownOps[operator] || OPERATORS[operator] : opts.operators[operator]
  },

  /**
   * Resolve the value of the specified option based on the given options and
   * this adapter's settings.
   *
   * @name RethinkDBAdapter#getOpt
   * @method
   * @param {string} opt The name of the option.
   * @param {Object} [opts] Configuration options.
   * @return {*} The value of the specified option.
   */
  getOpt (opt, opts) {
    opts || (opts = {})
    return isUndefined(opts[opt]) ? plainCopy(this[opt]) : plainCopy(opts[opt])
  },

  /**
   * Logging utility method.
   *
   * @name RethinkDBAdapter#log
   * @method
   */
  log (level, ...args) {
    if (level && !args.length) {
      args.push(level)
      level = 'debug'
    }
    if (level === 'debug' && !this.debug) {
      return
    }
    const prefix = `${level.toUpperCase()}: (RethinkDBAdapter)`
    if (console[level]) {
      console[level](prefix, ...args)
    } else {
      console.log(prefix, ...args)
    }
  },

  /**
   * Apply the given update to the record with the specified primary key.
   *
   * @name RethinkDBAdapter#update
   * @method
   * @param {Object} mapper The mapper.
   * @param {(string|number)} id The primary key of the record to be updated.
   * @param {Object} props The update to apply to the record.
   * @param {Object} [opts] Configuration options.
   * @param {Object} [opts.updateOpts] Options to pass to r#update.
   * @param {boolean} [opts.raw=false] Whether to return a more detailed
   * response object.
   * @param {Object} [opts.runOpts] Options to pass to r#run.
   * @return {Promise}
   */
  update (mapper, id, props, opts) {
    const self = this
    props || (props = {})
    opts || (opts = {})
    let op

    return self.waitForTable(mapper, opts).then(function () {
      // beforeUpdate lifecycle hook
      op = opts.op = 'beforeUpdate'
      return resolve(self[op](mapper, id, props, opts))
    }).then(function (_props) {
      // Allow for re-assignment from lifecycle hook
      _props = isUndefined(_props) ? props : _props
      const updateOpts = self.getOpt('updateOpts', opts)
      updateOpts.returnChanges = true
      return self.selectTable(mapper, opts).get(id).update(_props, updateOpts).run(self.getOpt('runOpts', opts))
    }).then(function (cursor) {
      let record
      self._handleErrors(cursor)
      if (cursor && cursor.changes && cursor.changes.length && cursor.changes[0].new_val) {
        record = cursor.changes[0].new_val
      } else {
        throw new Error('Not Found')
      }

      // afterUpdate lifecycle hook
      op = opts.op = 'afterUpdate'
      return resolve(self[op](mapper, id, props, opts, record)).then(function (_record) {
        // Allow for re-assignment from lifecycle hook
        record = isUndefined(_record) ? record : _record
        const result = {}
        fillIn(result, cursor)
        result.data = record
        result.updated = record ? 1 : 0
        return self.getOpt('raw', opts) ? result : result.data
      })
    })
  },

  /**
   * Apply the given update to all records that match the selection query.
   *
   * @name RethinkDBAdapter#updateAll
   * @method
   * @param {Object} mapper The mapper.
   * @param {Object} props The update to apply to the selected records.
   * @param {Object} [query] Selection query.
   * @param {Object} [query.where] Filtering criteria.
   * @param {string|Array} [query.orderBy] Sorting criteria.
   * @param {string|Array} [query.sort] Same as `query.sort`.
   * @param {number} [query.limit] Limit results.
   * @param {number} [query.skip] Offset results.
   * @param {number} [query.offset] Same as `query.skip`.
   * @param {Object} [opts] Configuration options.
   * @param {Object} [opts.operators] Override the default predicate functions
   * for specified operators.
   * @param {boolean} [opts.raw=false] Whether to return a more detailed
   * response object.
   * @param {Object} [opts.runOpts] Options to pass to r#run.
   * @param {Object} [opts.updateOpts] Options to pass to r#update.
   * @return {Promise}
   */
  updateAll (mapper, props, query, opts) {
    const self = this
    props || (props = {})
    query || (query = {})
    opts || (opts = {})
    let op

    return self.waitForTable(mapper, opts).then(function () {
      // beforeUpdateAll lifecycle hook
      op = opts.op = 'beforeUpdateAll'
      return resolve(self[op](mapper, props, query, opts))
    }).then(function (_props) {
      // Allow for re-assignment from lifecycle hook
      _props = isUndefined(_props) ? props : _props
      const updateOpts = self.getOpt('updateOpts', opts)
      updateOpts.returnChanges = true
      return self.filterSequence(self.selectTable(mapper, opts), query).update(_props, updateOpts).run(self.getOpt('runOpts', opts))
    }).then(function (cursor) {
      let records = []
      self._handleErrors(cursor)
      if (cursor && cursor.changes && cursor.changes.length) {
        records = cursor.changes.map(function (change) { return change.new_val })
      }
      // afterUpdateAll lifecycle hook
      op = opts.op = 'afterUpdateAll'
      return self[op](mapper, props, query, opts, records).then(function (_records) {
        // Allow for re-assignment from lifecycle hook
        records = isUndefined(_records) ? records : _records
        const result = {}
        fillIn(result, cursor)
        result.data = records
        result.updated = records.length
        return self.getOpt('raw', opts) ? result : result.data
      })
    })
  },

  /**
   * Update the given records in a single batch.
   *
   * @name RethinkDBAdapter#updateMany
   * @method
   * @param {Object} mapper The mapper.
   * @param {Object[]} records The records to update.
   * @param {Object} [opts] Configuration options.
   * @param {Object} [opts.insertOpts] Options to pass to r#insert.
   * @param {boolean} [opts.raw=false] Whether to return a more detailed
   * response object.
   * @param {Object} [opts.runOpts] Options to pass to r#run.
   * @return {Promise}
   */
  updateMany (mapper, records, opts) {
    const self = this
    records || (records = [])
    opts || (opts = {})
    let op
    const idAttribute = mapper.idAttribute

    records = records.filter(function (record) {
      return get(record, idAttribute)
    })

    return self.waitForTable(mapper, opts).then(function () {
      // beforeUpdateMany lifecycle hook
      op = opts.op = 'beforeUpdateMany'
      return resolve(self[op](mapper, records, opts))
    }).then(function (_records) {
      // Allow for re-assignment from lifecycle hook
      _records = isUndefined(_records) ? records : _records
      const insertOpts = self.getOpt('insertOpts', opts)
      insertOpts.returnChanges = true
      insertOpts.conflict = 'update'
      return self.selectTable(mapper, opts).insert(_records, insertOpts).run(self.getOpt('runOpts', opts))
    }).then(function (cursor) {
      let updatedRecords
      self._handleErrors(cursor)
      if (cursor && cursor.changes && cursor.changes.length) {
        updatedRecords = cursor.changes.map(function (change) { return change.new_val })
      }

      // afterUpdateMany lifecycle hook
      op = opts.op = 'afterUpdateMany'
      return resolve(self[op](mapper, records, opts, updatedRecords)).then(function (_records) {
        // Allow for re-assignment from lifecycle hook
        records = isUndefined(_records) ? updatedRecords : _records
        const result = {}
        fillIn(result, cursor)
        result.data = records
        result.updated = records.length
        return self.getOpt('raw', opts) ? result : result.data
      })
    })
  },

  waitForTable (mapper, options) {
    const table = isString(mapper) ? mapper : (mapper.table || underscore(mapper.name))
    options = options || {}
    let db = isUndefined(options.db) ? this.db : options.db
    return this.waitForDb(options).then(() => {
      this.tables[db] = this.tables[db] || {}
      if (!this.tables[db][table]) {
        this.tables[db][table] = this.r.branch(this.r.db(db).tableList().contains(table), true, this.r.db(db).tableCreate(table)).run()
      }
      return this.tables[db][table]
    })
  },

  waitForIndex (table, index, options) {
    options = options || {}
    let db = isUndefined(options.db) ? this.db : options.db
    return this.waitForDb(options).then(() => this.waitForTable(table, options)).then(() => {
      this.indices[db] = this.indices[db] || {}
      this.indices[db][table] = this.indices[db][table] || {}
      if (!this.tables[db][table][index]) {
        this.tables[db][table][index] = this.r.branch(this.r.db(db).table(table).indexList().contains(index), true, this.r.db(db).table(table).indexCreate(index)).run().then(() => {
          return this.r.db(db).table(table).indexWait(index).run()
        })
      }
      return this.tables[db][table][index]
    })
  }
})

RethinkDBAdapter.OPERATORS = OPERATORS
