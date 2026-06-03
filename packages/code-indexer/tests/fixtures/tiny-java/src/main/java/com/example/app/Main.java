package com.example.app;

import com.example.service.UserService;
import com.example.model.*;
import java.util.List;
import static java.lang.Math.max; // static import -> resolves to java.lang.Math (external, unresolved)

public class Main {
    public static void main(String[] args) {
        List<UserService> services = null;
        int n = max(1, 2);
    }
}
