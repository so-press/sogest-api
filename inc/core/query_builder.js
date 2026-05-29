/**
 * Accumulateur de conditions `AND` et d'une clause `ORDER BY` pour construire une
 * requête SQL paramétrée. Voir aussi `inc/utils.js` et knex (`db.js`) pour les
 * usages plus complexes.
 */
export class QueryBuilder {
  /**
   * @param {string} base SQL de base, déjà terminé par un `WHERE 1=1` (les ajouts sont préfixés par `AND`)
   */
  constructor(base) {
    this.sql = base;
    this.conditions = [];
    this.params = [];
    this.order = '';
  }

  /**
   * Ajoute une condition `AND <condition>` avec sa valeur.
   * @param {string} condition
   * @param {*} param
   * @returns {QueryBuilder}
   */
  where(condition, param) {
    this.conditions.push(condition);
    this.params.push(param);
    return this;
  }

  /** Alias de {@link where}. */
  and(condition, param) {
    return this.where(condition, param);
  }

  /**
   * Définit la clause ORDER BY.
   * @param {string} order
   * @returns {QueryBuilder}
   */
  orderBy(order) {
    this.order = order;
    return this;
  }

  /**
   * Construit la requête finale.
   * @returns {{sql: string, params: any[]}}
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
