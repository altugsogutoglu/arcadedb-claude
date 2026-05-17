<?php

namespace App\Services;

use App\Models\User;

class AuthService
{
    public function findByEmail(string $email): ?User
    {
        return User::where('email', $email)->first();
    }
}
