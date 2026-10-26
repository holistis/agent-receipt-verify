<?php
// Served by `php -S`. Reports how PHP exposes the query.
header('Content-Type: application/json');
parse_str($_SERVER['QUERY_STRING'], $ps);
echo json_encode([
  'single' => array_key_exists('q', $_GET) ? $_GET['q'] : null,
  'all' => 'n/a',
  'keys' => array_keys($_GET),
  'parse_str_q' => array_key_exists('q', $ps) ? $ps['q'] : null,
  'request_q' => array_key_exists('q', $_REQUEST) ? $_REQUEST['q'] : null,
  'raw' => $_SERVER['QUERY_STRING'],
  'php' => PHP_VERSION,
]);
