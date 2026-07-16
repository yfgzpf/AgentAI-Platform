declare module 'sql.js' {
  interface Database {
    exec(sql: string): { columns: string[]; values: any[][] }[];
    prepare(stmt: string): { all(...params: any[]): any[]; get(...params: any[]): any; run(params: any): any };
    close(): void;
  }
  interface SqlJsStatic {
    Database: new (data?: Uint8Array) => Database;
  }
  interface InitOptions {
    locateFile?: (file: string) => string;
  }
  function initSqlJs(options?: InitOptions): Promise<SqlJsStatic>;
  export default initSqlJs;
}

declare module 'better-sqlite3' {
  interface Database {
    prepare(sql: string): { all(...params: any[]): any[]; get(...params: any[]): any; run(...params: any[]): any };
    close(): void;
    pragma(pragma: string): any[];
  }
  interface DatabaseOptions {
    readonly?: boolean;
    fileMustExist?: boolean;
  }
  function Database(path: string, options?: DatabaseOptions): Database;
  export = Database;
}

declare module 'nodemailer';
