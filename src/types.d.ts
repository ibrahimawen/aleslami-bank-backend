declare module 'sql.js' {
  interface Database {
    run(sql: string, params?: any[]): Database;
    exec(sql: string): any[];
    prepare(sql: string): any;
    export(): Uint8Array;
    close(): void;
    getRowsModified(): number;
  }

  interface SqlJsStatic {
    Database: new (data?: ArrayLike<number>) => Database;
  }

  function initSqlJs(config?: any): Promise<SqlJsStatic>;
  export default initSqlJs;
  export { Database, SqlJsStatic };
}
