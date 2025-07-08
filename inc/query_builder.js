/**
 * @namespace QueryBuilder
 */
export class QueryBuilder {
  /**
   * @api {function} QueryBuilder Constructeur
   * @apiName QueryBuilder
   * @apiGroup QueryBuilder
   *
   * @apiParam {String} base Base de la requête SQL
   */
  constructor(base) {
    this.sql = base;
    this.conditions = [];
    this.params = [];
    this.order = '';
  }

  /**
   * @api {function} where Ajoute une condition WHERE
   * @apiName QueryWhere
   * @apiGroup QueryBuilder
   * @apiParam {String} condition Condition SQL
   * @apiParam {*} param Valeur associée
   * @apiSuccess {QueryBuilder} builder Instance courante
   */
  where(condition, param) {
    this.conditions.push(condition);
    this.params.push(param);
    return this;
  }

  /**
   * @api {function} and Alias de where
   * @apiName QueryAnd
   * @apiGroup QueryBuilder
   */
  and(condition, param) {
    return this.where(condition, param);
  }

  /**
   * @api {function} orderBy Ajoute un ORDER BY
   * @apiName QueryOrderBy
   * @apiGroup QueryBuilder
   * @apiParam {String} order Clause ORDER BY
   * @apiSuccess {QueryBuilder} builder Instance courante
   */
  orderBy(order) {
    this.order = order;
    return this;
  }

  /**
   * @api {function} build Construit la requête complète
   * @apiName QueryBuild
   * @apiGroup QueryBuilder
   * @apiSuccess {Object} query Objet contenant la chaîne SQL et les paramètres
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

