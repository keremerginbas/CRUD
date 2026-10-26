import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import mysql from 'mysql2/promise';

const useMysql=Boolean(process.env.DATABASE_URL);
const sqlitePath=path.resolve(process.env.SQLITE_PATH||'./data/xre-parsel.sqlite');
let sqlite;
if(!useMysql){
 fs.mkdirSync(path.dirname(sqlitePath),{recursive:true});
 sqlite=new DatabaseSync(sqlitePath);
 sqlite.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS parcels(id INTEGER PRIMARY KEY AUTOINCREMENT,province TEXT NOT NULL,district TEXT NOT NULL,neighborhood TEXT NOT NULL,block_no TEXT NOT NULL,parcel_no TEXT NOT NULL,geometry TEXT,area_m2 REAL,source_name TEXT,source_checked_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(province,district,neighborhood,block_no,parcel_no));
 CREATE TABLE IF NOT EXISTS map_markers(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id TEXT NOT NULL DEFAULT 'local',parcel_id INTEGER,lat REAL NOT NULL,lng REAL NOT NULL,note TEXT DEFAULT '',color TEXT DEFAULT 'red',is_favorite INTEGER DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(parcel_id) REFERENCES parcels(id) ON DELETE SET NULL);
 CREATE TABLE IF NOT EXISTS query_jobs(id INTEGER PRIMARY KEY AUTOINCREMENT,parcel_id INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'queued',error_message TEXT,attempts INTEGER DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(parcel_id) REFERENCES parcels(id));
 CREATE TABLE IF NOT EXISTS ai_analyses(id INTEGER PRIMARY KEY AUTOINCREMENT,parcel_id INTEGER,marker_id INTEGER,analysis TEXT NOT NULL,context_json TEXT,model TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS comparables(id INTEGER PRIMARY KEY AUTOINCREMENT,source TEXT NOT NULL,listing_id TEXT NOT NULL,title TEXT,price REAL,currency TEXT,area REAL,city TEXT,district TEXT,neighborhood TEXT,city_key TEXT,district_key TEXT,neighborhood_key TEXT,category TEXT,url TEXT,imar TEXT,kaks TEXT,tapu TEXT,ada_parsel TEXT,listing_status TEXT,captured_at TEXT,imported_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(source,listing_id));
 CREATE INDEX IF NOT EXISTS idx_comparables_area ON comparables(city_key,district_key,neighborhood_key);
 CREATE INDEX IF NOT EXISTS idx_markers_user ON map_markers(user_id);`);
 // V13: parsel niteligi/paftasi da arsivlenir (eski veritabanlarinda sutun yoksa eklenir).
 for(const column of ['qualification TEXT','sheet TEXT']){try{sqlite.exec(`ALTER TABLE parcels ADD COLUMN ${column}`)}catch{}}
 console.log('SQLite local database ready:',sqlitePath);
}
const sqliteAdapter={
 async execute(sql,params=[]){
  const statement=sqlite.prepare(sql);
  // node:sqlite does not bind JavaScript booleans; SQLite stores flags as 0/1.
  params=params.map(value=>typeof value==='boolean'?(value?1:0):value);
  if(/^\s*SELECT/i.test(sql)){return [statement.all(...params)];}
  const result=statement.run(...params);
  return [{insertId:Number(result.lastInsertRowid),affectedRows:result.changes}];
 },
 async query(sql,params=[]){return this.execute(sql,params)}
};
export const pool=useMysql?mysql.createPool({uri:process.env.DATABASE_URL,connectionLimit:5}):sqliteAdapter;
export const databaseMode=useMysql?'mysql':'sqlite';
export async function requireDb(_res){return true}
