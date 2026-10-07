<?php
declare(strict_types=1);

namespace BlogPanel;

use PDO;

final class Database
{
    public readonly PDO $pdo;
    public readonly string $driver;

    public function __construct(array $cfg)
    {
        $this->driver = $cfg['driver'] ?? 'mysql';
        if ($this->driver === 'sqlite') {
            $this->pdo = new PDO('sqlite:' . $cfg['path']);
            $this->pdo->exec('PRAGMA foreign_keys = ON');
            $this->pdo->exec('PRAGMA busy_timeout = 5000');
        } else {
            $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $cfg['host'], (int) ($cfg['port'] ?? 3306), $cfg['name']);
            $this->pdo = new PDO($dsn, $cfg['user'], $cfg['pass'], [PDO::MYSQL_ATTR_INIT_COMMAND => "SET time_zone = '" . date('P') . "'"]);
        }
        $this->pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $this->pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    }

    public function run(string $sql, array $params = []): \PDOStatement
    {
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
        return $stmt;
    }

    public function one(string $sql, array $params = []): ?array
    {
        $row = $this->run($sql, $params)->fetch();
        return $row === false ? null : $row;
    }

    public function all(string $sql, array $params = []): array
    {
        return $this->run($sql, $params)->fetchAll();
    }

    public function value(string $sql, array $params = []): mixed
    {
        $v = $this->run($sql, $params)->fetchColumn();
        return $v === false ? null : $v;
    }

    public function insert(string $table, array $data): int
    {
        $cols = array_keys($data);
        $sql = sprintf(
            'INSERT INTO %s (%s) VALUES (%s)',
            $table,
            implode(', ', $cols),
            implode(', ', array_map(static fn ($c) => ':' . $c, $cols))
        );
        $this->run($sql, $data);
        return (int) $this->pdo->lastInsertId();
    }

    public function update(string $table, array $data, string $where, array $whereParams = []): int
    {
        $sets = [];
        $params = [];
        foreach ($data as $col => $val) {
            $sets[] = "$col = :set_$col";
            $params["set_$col"] = $val;
        }
        $sql = sprintf('UPDATE %s SET %s WHERE %s', $table, implode(', ', $sets), $where);
        return $this->run($sql, $params + $whereParams)->rowCount();
    }

    public static function now(): string
    {
        return date('Y-m-d H:i:s');
    }
}
