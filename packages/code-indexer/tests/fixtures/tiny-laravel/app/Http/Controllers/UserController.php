<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Services\AuthService;

class UserController
{
    public function index(AuthService $auth)
    {
        return User::all();
    }
}
