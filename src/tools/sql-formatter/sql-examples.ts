// Se mantiene aparte de sql-formatter.ts para que la interfaz pueda mostrar los ejemplos
// sin cargar la biblioteca de formato, que se descarga solo al formatear.
import type { Dialect } from './sql-formatter';

export const SQL_EXAMPLES: { label: string; dialect: Dialect; sql: string }[] = [
  {
    label: 'MySQL: consulta con JOIN',
    dialect: 'mysql',
    sql: "select u.id, u.`name`, count(o.id) as pedidos from `users` u left join orders o on o.user_id = u.id where u.active = 1 and u.created_at > '2024-01-01' group by u.id, u.`name` having count(o.id) > 2 order by pedidos desc limit 10, 5",
  },
  {
    label: 'MySQL: INSERT con upsert',
    dialect: 'mysql',
    sql: "insert into stock (sku, qty) values ('A1', 5), ('B2', 8) on duplicate key update qty = qty + values(qty)",
  },
  {
    label: 'SQL Server: TOP y CTE',
    dialect: 'transactsql',
    sql: 'with recientes as (select top 100 [o].[id], [o].[total] from [dbo].[orders] [o] where [o].[created] > @desde order by [o].[created] desc) select r.id, r.total, c.[name] from recientes r inner join [dbo].[customers] c on c.id = r.id',
  },
  {
    label: 'SQL Server: con error',
    dialect: 'transactsql',
    sql: "select [name], total from [dbo].[orders]\nwhere status = 'pagado",
  },
];
