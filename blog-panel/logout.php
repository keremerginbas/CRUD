<?php
declare(strict_types=1);
require __DIR__ . '/app/bootstrap.php';

BlogPanel\Auth::logout();
redirect('login.php');
