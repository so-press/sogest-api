/**
 * @namespace QueryBuilder
 */
export class QueryBuilder {
  /**
   * @param {string} base - Base de la requête SQL
   */
  constructor(base) {
    this.sql = base;
    this.conditions = [];
    this.params = [];
    this.order = '';
  }

  /**
   * Ajoute une condition WHERE
   * @param {string} condition - Condition SQL
   * @param {*} param - Valeur associée
   * @returns {QueryBuilder}
   */
  where(condition, param) {
    this.conditions.push(condition);
    this.params.push(param);
    return this;
  }

  /**
   * Alias de {@link where}
   */
  and(condition, param) {
    return this.where(condition, param);
  }

  /**
   * Ajoute un ORDER BY
   * @param {string} order - Clause ORDER BY
   * @returns {QueryBuilder}
   */
  orderBy(order) {
    this.order = order;
    return this;
  }

  /**
   * Construit la requête complète
   * @returns {{sql:string, params:Array}}
   */
  build() {
    let fullQuery = this.sql;
    if (this.conditions.length) {
      fullQuery += ' AND ' + this.conditions.join(' AND ');
    }
    if (this.order) {
      fullQuery += ' ORDER BY ' + this.order;
    }
    return { sql: fullQuery, params: this.params };
  }
}

