let rethinkdbdash = require('rethinkdbdash')
let JSData = require('js-data')
let { DSUtils } = JSData
let { upperCase, contains, forOwn, isEmpty, keys, deepMixIn, forEach, isObject, isString, removeCircular, omit } = DSUtils

let underscore = require('mout/string/underscore')

const reserved = [
  'orderBy',
  'sort',
  'limit',
  'offset',
  'skip',
  'where'
]

const addHiddenPropsToTarget = function (target, props) {
  DSUtils.forOwn(props, function (value, key) {
    props[key] = {
      writable: true,
      value
    }
  })
  Object.defineProperties(target, props)
}

const fillIn = function (dest, src) {
  DSUtils.forOwn(src, function (value, key) {
    if (!dest.hasOwnProperty(key) || dest[key] === undefined) {
      dest[key] = value
    }
  })
}

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

class Defaults {

}

addHiddenPropsToTarget(Defaults.prototype, {
  host: 'localhost',
  port: 28015,
  authKey: '',
  db: 'test',
  min: 10,
  max: 50,
  bufferSize: 10
})

/**
 * RethinkDBAdapter class.
 *
 * @example
 * import {DS} from 'js-data'
 * import RethinkDBAdapter from 'js-data-rethinkdb'
 * const store = new DS()
 * const adapter = new RethinkDBAdapter()
 * store.registerAdapter('rethinkdb', adapter, { 'default': true })
 *
 * @class RethinkDBAdapter
 * @param {Object} [opts] Configuration opts.
 * @param {string} [opts.host='localhost'] TODO
 * @param {number} [opts.port=28015] TODO
 * @param {string} [opts.authKey=''] TODO
 * @param {string} [opts.db='test'] TODO
 * @param {number} [opts.min=10] TODO
 * @param {number} [opts.max=50] TODO
 * @param {number} [opts.bufferSize=10] TODO
 */
export default function RethinkDBAdapter (opts) {
  const self = this

  self.defaults = new Defaults()
  deepMixIn(self.defaults, opts)
  fillIn(self, opts)
  self.r = rethinkdbdash(self.defaults)
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

  selectTable (Resource, opts) {
    return this.r.db(opts.db || this.defaults.db).table(Resource.table || underscore(Resource.name))
  },

  filterSequence (sequence, params) {
    let r = this.r
    params = params || {}
    params.where = params.where || {}
    params.orderBy = params.orderBy || params.sort
    params.skip = params.skip || params.offset

    forEach(keys(params), function (k) {
      let v = params[k]
      if (!contains(reserved, k)) {
        if (isObject(v)) {
          params.where[k] = v
        } else {
          params.where[k] = {
            '==': v
          }
        }
        delete params[k]
      }
    })

    let query = sequence

    if (!isEmpty(params.where)) {
      query = query.filter((row) => {
        let subQuery
        forOwn(params.where, function (criteria, field) {
          if (!isObject(criteria)) {
            criteria = {'==': criteria}
          }
          forOwn(criteria, function (v, op) {
            if (op === '==' || op === '===') {
              subQuery = subQuery ? subQuery.and(row(field).default(null).eq(v)) : row(field).default(null).eq(v)
            } else if (op === '!=' || op === '!==') {
              subQuery = subQuery ? subQuery.and(row(field).default(null).ne(v)) : row(field).default(null).ne(v)
            } else if (op === '>') {
              subQuery = subQuery ? subQuery.and(row(field).default(null).gt(v)) : row(field).default(null).gt(v)
            } else if (op === '>=') {
              subQuery = subQuery ? subQuery.and(row(field).default(null).ge(v)) : row(field).default(null).ge(v)
            } else if (op === '<') {
              subQuery = subQuery ? subQuery.and(row(field).default(null).lt(v)) : row(field).default(null).lt(v)
            } else if (op === '<=') {
              subQuery = subQuery ? subQuery.and(row(field).default(null).le(v)) : row(field).default(null).le(v)
            } else if (op === 'isectEmpty') {
              subQuery = subQuery ? subQuery.and(row(field).default([]).setIntersection(r.expr(v).default([])).count().eq(0)) : row(field).default([]).setIntersection(r.expr(v).default([])).count().eq(0)
            } else if (op === 'isectNotEmpty') {
              subQuery = subQuery ? subQuery.and(row(field).default([]).setIntersection(r.expr(v).default([])).count().ne(0)) : row(field).default([]).setIntersection(r.expr(v).default([])).count().ne(0)
            } else if (op === 'in') {
              subQuery = subQuery ? subQuery.and(r.expr(v).default(r.expr([])).contains(row(field).default(null))) : r.expr(v).default(r.expr([])).contains(row(field).default(null))
            } else if (op === 'notIn') {
              subQuery = subQuery ? subQuery.and(r.expr(v).default(r.expr([])).contains(row(field).default(null)).not()) : r.expr(v).default(r.expr([])).contains(row(field).default(null)).not()
            } else if (op === '|==' || op === '|===') {
              subQuery = subQuery ? subQuery.or(row(field).default(null).eq(v)) : row(field).default(null).eq(v)
            } else if (op === '|!=' || op === '|!==') {
              subQuery = subQuery ? subQuery.or(row(field).default(null).ne(v)) : row(field).default(null).ne(v)
            } else if (op === '|>') {
              subQuery = subQuery ? subQuery.or(row(field).default(null).gt(v)) : row(field).default(null).gt(v)
            } else if (op === '|>=') {
              subQuery = subQuery ? subQuery.or(row(field).default(null).ge(v)) : row(field).default(null).ge(v)
            } else if (op === '|<') {
              subQuery = subQuery ? subQuery.or(row(field).default(null).lt(v)) : row(field).default(null).lt(v)
            } else if (op === '|<=') {
              subQuery = subQuery ? subQuery.or(row(field).default(null).le(v)) : row(field).default(null).le(v)
            } else if (op === '|isectEmpty') {
              subQuery = subQuery ? subQuery.or(row(field).default([]).setIntersection(r.expr(v).default([])).count().eq(0)) : row(field).default([]).setIntersection(r.expr(v).default([])).count().eq(0)
            } else if (op === '|isectNotEmpty') {
              subQuery = subQuery ? subQuery.or(row(field).default([]).setIntersection(r.expr(v).default([])).count().ne(0)) : row(field).default([]).setIntersection(r.expr(v).default([])).count().ne(0)
            } else if (op === '|in') {
              subQuery = subQuery ? subQuery.or(r.expr(v).default(r.expr([])).contains(row(field).default(null))) : r.expr(v).default(r.expr([])).contains(row(field).default(null))
            } else if (op === '|notIn') {
              subQuery = subQuery ? subQuery.or(r.expr(v).default(r.expr([])).contains(row(field).default(null)).not()) : r.expr(v).default(r.expr([])).contains(row(field).default(null)).not()
            }
          })
        })
        return subQuery
      })
    }

    if (params.orderBy) {
      if (isString(params.orderBy)) {
        params.orderBy = [
          [params.orderBy, 'asc']
        ]
      }
      for (var i = 0; i < params.orderBy.length; i++) {
        if (isString(params.orderBy[i])) {
          params.orderBy[i] = [params.orderBy[i], 'asc']
        }
        query = upperCase(params.orderBy[i][1]) === 'DESC' ? query.orderBy(r.desc(params.orderBy[i][0])) : query.orderBy(params.orderBy[i][0])
      }
    }

    if (params.skip) {
      query = query.skip(+params.skip)
    }

    if (params.limit) {
      query = query.limit(+params.limit)
    }

    return query
  },

  waitForDb (opts) {
    const self = this
    opts = opts || {}
    let db = opts.db || self.defaults.db
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
   * @param {Object} Resource The Resource.
   * @param {Object} props The record to be created.
   * @param {Object} [opts] Configuration options.
   * @return {Promise}
   */
  create (Resource, props, opts) {
    const self = this
    props = removeCircular(omit(props, Resource.relationFields || []))
    opts || (opts = {})

    return self.waitForTable(Resource.table || underscore(Resource.name), opts).then(function () {
      return self.selectTable(Resource, opts).insert(props, {returnChanges: true}).run()
    }).then(function (cursor) {
      self._handleErrors(cursor)
      return cursor.changes[0].new_val
    })
  },

  /**
   * Destroy the record with the given primary key.
   *
   * @name RethinkDBAdapter#destroy
   * @method
   * @param {Object} Resource The Resource.
   * @param {(string|number)} id Primary key of the record to destroy.
   * @param {Object} [opts] Configuration options.
   * @return {Promise}
   */
  destroy (Resource, id, opts) {
    const self = this
    opts || (opts = {})

    return self.waitForTable(Resource.table || underscore(Resource.name), opts).then(function () {
      return self.selectTable(Resource, opts).get(id).delete().run()
    }).then(function () {
      return undefined
    })
  },

  /**
   * Destroy the records that match the selection query.
   *
   * @name RethinkDBAdapter#destroyAll
   * @method
   * @param {Object} Resource the Resource.
   * @param {Object} [query] Selection query.
   * @param {Object} [opts] Configuration options.
   * @return {Promise}
   */
  destroyAll (Resource, query, opts) {
    const self = this
    query || (query = {})
    opts || (opts = {})

    return self.waitForTable(Resource.table || underscore(Resource.name), opts).then(function () {
      return self.filterSequence(self.selectTable(Resource, opts), query).delete().run()
    }).then(function () {
      return undefined
    })
  },

  /**
   * TODO
   *
   * There may be reasons why you may want to override this method, like when
   * the id of the parent doesn't exactly match up to the key on the child.
   *
   * @name RethinkDBAdapter#makeHasManyForeignKey
   * @method
   * @return {*}
   */
  makeHasManyForeignKey (Resource, def, record) {
    return DSUtils.get(record, Resource.idAttribute)
  },

  /**
   * TODO
   *
   * @name RethinkDBAdapter#loadHasMany
   * @method
   * @return {Promise}
   */
  loadHasMany (Resource, def, records, __options) {
    const self = this
    let singular = false

    if (DSUtils.isObject(records) && !DSUtils.isArray(records)) {
      singular = true
      records = [records]
    }
    const IDs = records.map(function (record) {
      return self.makeHasManyForeignKey(Resource, def, record)
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
    return self.findAll(Resource.getResource(def.relation), query, __options).then(function (relatedItems) {
      records.forEach(function (record) {
        let attached = []
        // avoid unneccesary iteration when we only have one record
        if (singular) {
          attached = relatedItems
        } else {
          relatedItems.forEach(function (relatedItem) {
            if (DSUtils.get(relatedItem, def.foreignKey) === record[Resource.idAttribute]) {
              attached.push(relatedItem)
            }
          })
        }
        DSUtils.set(record, def.localField, attached)
      })
    })
  },

  /**
   * TODO
   *
   * @name RethinkDBAdapter#loadHasOne
   * @method
   * @return {Promise}
   */
  loadHasOne (Resource, def, records, __options) {
    if (DSUtils.isObject(records) && !DSUtils.isArray(records)) {
      records = [records]
    }
    return this.loadHasMany(Resource, def, records, __options).then(function () {
      records.forEach(function (record) {
        const relatedData = DSUtils.get(record, def.localField)
        if (DSUtils.isArray(relatedData) && relatedData.length) {
          DSUtils.set(record, def.localField, relatedData[0])
        }
      })
    })
  },

  /**
   * TODO
   *
   * @name RethinkDBAdapter#makeBelongsToForeignKey
   * @method
   * @return {*}
   */
  makeBelongsToForeignKey (Resource, def, record) {
    return DSUtils.get(record, def.localKey)
  },

  /**
   * TODO
   *
   * @name RethinkDBAdapter#loadBelongsTo
   * @method
   * @return {Promise}
   */
  loadBelongsTo (Resource, def, records, __options) {
    const self = this
    const relationDef = Resource.getResource(def.relation)

    if (DSUtils.isObject(records) && !DSUtils.isArray(records)) {
      const record = records
      return self.find(relationDef, self.makeBelongsToForeignKey(Resource, def, record), __options).then(function (relatedItem) {
        DSUtils.set(record, def.localField, relatedItem)
      })
    } else {
      const keys = records.map(function (record) {
        return self.makeBelongsToForeignKey(Resource, def, record)
      }).filter(function (key) {
        return key
      })
      return self.findAll(relationDef, {
        where: {
          [relationDef.idAttribute]: {
            'in': keys
          }
        }
      }, __options).then(function (relatedItems) {
        records.forEach(function (record) {
          relatedItems.forEach(function (relatedItem) {
            if (relatedItem[relationDef.idAttribute] === record[def.localKey]) {
              DSUtils.set(record, def.localField, relatedItem)
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
   * @param {Object} Resource The Resource.
   * @param {(string|number)} id Primary key of the record to retrieve.
   * @param {Object} [opts] Configuration options.
   * @param {string[]} [opts.with=[]] TODO
   * @return {Promise}
   */
  find (Resource, id, opts) {
    const self = this
    opts || (opts = {})
    opts.with || (opts.with = [])

    let instance
    const table = Resource.table || underscore(Resource.name)
    const relationList = Resource.relationList || []
    let tasks = [self.waitForTable(table, opts)]

    relationList.forEach(function (def) {
      const relationName = def.relation
      const relationDef = Resource.getResource(relationName)
      if (!relationDef) {
        throw new JSData.DSErrors.NER(relationName)
      } else if (!opts.with || !contains(opts.with, relationName)) {
        return
      }
      if (def.foreignKey) {
        tasks.push(self.waitForIndex(relationDef.table || underscore(relationDef.name), def.foreignKey, opts))
      } else if (def.localKey) {
        tasks.push(self.waitForIndex(Resource.table || underscore(Resource.name), def.localKey, opts))
      }
    })
    return DSUtils.Promise.all(tasks).then(function () {
      return self.selectTable(Resource, opts).get(id).run()
    }).then(function (_instance) {
      if (!_instance) {
        throw new Error('Not Found!')
      }
      instance = _instance
      let tasks = []

      relationList.forEach(function (def) {
        let relationName = def.relation
        let relationDef = Resource.getResource(relationName)
        let containedName = null
        if (opts.with.indexOf(relationName) !== -1) {
          containedName = relationName
        } else if (opts.with.indexOf(def.localField) !== -1) {
          containedName = def.localField
        }
        if (containedName) {
          let __options = DSUtils.deepMixIn({}, opts.orig ? opts.orig() : opts)
          __options.with = opts.with.slice()
          __options = DSUtils._(relationDef, __options)
          DSUtils.remove(__options.with, containedName)
          __options.with.forEach(function (relation, i) {
            if (relation && relation.indexOf(containedName) === 0 && relation.length >= containedName.length && relation[containedName.length] === '.') {
              __options.with[i] = relation.substr(containedName.length + 1)
            } else {
              __options.with[i] = ''
            }
          })

          let task

          if (def.foreignKey && (def.type === 'hasOne' || def.type === 'hasMany')) {
            if (def.type === 'hasOne') {
              task = self.loadHasOne(Resource, def, instance, __options)
            } else {
              task = self.loadHasMany(Resource, def, instance, __options)
            }
          } else if (def.type === 'hasMany' && def.localKeys) {
            let localKeys = []
            let itemKeys = instance[def.localKeys] || []
            itemKeys = DSUtils.isArray(itemKeys) ? itemKeys : DSUtils.keys(itemKeys)
            localKeys = localKeys.concat(itemKeys || [])
            task = self.findAll(Resource.getResource(relationName), {
              where: {
                [relationDef.idAttribute]: {
                  'in': unique(localKeys).filter((x) => x)
                }
              }
            }, __options).then(function (relatedItems) {
              DSUtils.set(instance, def.localField, relatedItems)
              return relatedItems
            })
          } else if (def.type === 'belongsTo' || (def.type === 'hasOne' && def.localKey)) {
            task = self.loadBelongsTo(Resource, def, instance, __options)
          }

          if (task) {
            tasks.push(task)
          }
        }
      })

      return DSUtils.Promise.all(tasks)
    }).then(function () {
      return instance
    })
  },

  /**
   * Retrieve the records that match the selection query.
   *
   * @name RethinkDBAdapter#findAll
   * @method
   * @param {Object} Resource The Resource.
   * @param {Object} query Selection query.
   * @param {Object} [opts] Configuration options.
   * @param {string[]} [opts.with=[]] TODO
   * @return {Promise}
   */
  findAll (Resource, query, opts) {
    const self = this
    opts || (opts = {})
    opts.with || (opts.with = [])

    let items = null
    const table = Resource.table || underscore(Resource.name)
    const relationList = Resource.relationList || []
    let tasks = [self.waitForTable(table, opts)]

    relationList.forEach(function (def) {
      const relationName = def.relation
      const relationDef = Resource.getResource(relationName)
      if (!relationDef) {
        throw new JSData.DSErrors.NER(relationName)
      } else if (!opts.with || !contains(opts.with, relationName)) {
        return
      }
      if (def.foreignKey) {
        tasks.push(self.waitForIndex(relationDef.table || underscore(relationDef.name), def.foreignKey, opts))
      } else if (def.localKey) {
        tasks.push(self.waitForIndex(Resource.table || underscore(Resource.name), def.localKey, opts))
      }
    })
    return DSUtils.Promise.all(tasks).then(function () {
      return self.filterSequence(self.selectTable(Resource, opts), query).run()
    }).then(function (_items) {
      items = _items
      let tasks = []
      const relationList = Resource.relationList || []
      relationList.forEach(function (def) {
        let relationName = def.relation
        let relationDef = Resource.getResource(relationName)
        let containedName = null
        if (opts.with.indexOf(relationName) !== -1) {
          containedName = relationName
        } else if (opts.with.indexOf(def.localField) !== -1) {
          containedName = def.localField
        }
        if (containedName) {
          let __options = DSUtils.deepMixIn({}, opts.orig ? opts.orig() : opts)
          __options.with = opts.with.slice()
          __options = DSUtils._(relationDef, __options)
          DSUtils.remove(__options.with, containedName)
          __options.with.forEach(function (relation, i) {
            if (relation && relation.indexOf(containedName) === 0 && relation.length >= containedName.length && relation[containedName.length] === '.') {
              __options.with[i] = relation.substr(containedName.length + 1)
            } else {
              __options.with[i] = ''
            }
          })

          let task

          if (def.foreignKey && (def.type === 'hasOne' || def.type === 'hasMany')) {
            if (def.type === 'hasMany') {
              task = self.loadHasMany(Resource, def, items, __options)
            } else {
              task = self.loadHasOne(Resource, def, items, __options)
            }
          } else if (def.type === 'hasMany' && def.localKeys) {
            let localKeys = []
            items.forEach(function (item) {
              let itemKeys = item[def.localKeys] || []
              itemKeys = DSUtils.isArray(itemKeys) ? itemKeys : Object.keys(itemKeys)
              localKeys = localKeys.concat(itemKeys || [])
            })
            task = self.findAll(Resource.getResource(relationName), {
              where: {
                [relationDef.idAttribute]: {
                  'in': unique(localKeys).filter((x) => x)
                }
              }
            }, __options).then(function (relatedItems) {
              items.forEach(function (item) {
                let attached = []
                let itemKeys = item[def.localKeys] || []
                itemKeys = DSUtils.isArray(itemKeys) ? itemKeys : DSUtils.keys(itemKeys)
                relatedItems.forEach(function (relatedItem) {
                  if (itemKeys && itemKeys.indexOf(relatedItem[relationDef.idAttribute]) !== -1) {
                    attached.push(relatedItem)
                  }
                })
                DSUtils.set(item, def.localField, attached)
              })
              return relatedItems
            })
          } else if (def.type === 'belongsTo' || (def.type === 'hasOne' && def.localKey)) {
            task = self.loadBelongsTo(Resource, def, items, __options)
          }

          if (task) {
            tasks.push(task)
          }
        }
      })
      return DSUtils.Promise.all(tasks)
    }).then(function () {
      return items
    })
  },

  /**
   * Apply the given update to the record with the specified primary key.
   *
   * @name RethinkDBAdapter#update
   * @method
   * @param {Object} Resource The Resource.
   * @param {(string|number)} id The primary key of the record to be updated.
   * @param {Object} props The update to apply to the record.
   * @param {Object} [opts] Configuration options.
   * @return {Promise}
   */
  update (resourceConfig, id, attrs, options) {
    attrs = removeCircular(omit(attrs, resourceConfig.relationFields || []))
    options = options || {}
    return this.waitForTable(resourceConfig.table || underscore(resourceConfig.name), options).then(() => {
      return this.r.db(options.db || this.defaults.db).table(resourceConfig.table || underscore(resourceConfig.name)).get(id).update(attrs, {returnChanges: true}).run()
    }).then((cursor) => {
      this._handleErrors(cursor)
      if (cursor.changes && cursor.changes.length && cursor.changes[0].new_val) {
        return cursor.changes[0].new_val
      } else {
        return this.selectTable(resourceConfig, options).get(id).run()
      }
    })
  },

  /**
   * Apply the given update to all records that match the selection query.
   *
   * @name RethinkDBAdapter#updateAll
   * @method
   * @param {Object} Resource The Resource.
   * @param {Object} props The update to apply to the selected records.
   * @param {Object} [query] Selection query.
   * @param {Object} [opts] Configuration options.
   * @return {Promise}
   */
  updateAll (resourceConfig, attrs, params, options) {
    attrs = removeCircular(omit(attrs, resourceConfig.relationFields || []))
    options = options || {}
    params = params || {}
    return this.waitForTable(resourceConfig.table || underscore(resourceConfig.name), options).then(() => {
      return this.filterSequence(this.selectTable(resourceConfig, options), params).update(attrs, {returnChanges: true}).run()
    }).then((cursor) => {
      this._handleErrors(cursor)
      if (cursor && cursor.changes && cursor.changes.length) {
        let items = []
        cursor.changes.forEach((change) => items.push(change.new_val))
        return items
      } else {
        return this.filterSequence(this.selectTable(resourceConfig, options), params).run()
      }
    })
  },

  waitForTable (table, options) {
    options = options || {}
    let db = options.db || this.defaults.db
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
    let db = options.db || this.defaults.db
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
