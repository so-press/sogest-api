export class QueryBuilder {
  constructor(base) {
    this.sql = base;
    this.conditions = [];
    this.params = [];
    this.order = '';
  }

  where(condition, param) {
    this.conditions.push(condition);
    this.params.push(param);
    return this;
  }

  and(condition, param) {
    return this.where(condition, param);
  }

  orderBy(order) {
    this.order = order;
    return this;
  }

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
