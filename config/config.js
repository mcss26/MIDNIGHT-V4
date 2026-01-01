// config.js
// Pegá tus credenciales (Supabase Dashboard → Project Settings → API)
window.SUPABASE_URL = "https://zlhnxrsbdhbmqwlbyqbt.supabase.co";
window.SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsaG54cnNiZGhibXF3bGJ5cWJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY4MDcyODksImV4cCI6MjA4MjM4MzI4OX0.rYswrDQIZ1Qcx11MMgCMWaC-ZDmDuTpjFMramnvgT0M";

// Validación básica
if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) {
    console.error("Faltan SUPABASE_URL / SUPABASE_ANON_KEY en config.js");
}

// Crear cliente (requiere que el UMD de Supabase ya esté cargado)
if (!window.supabase || typeof window.supabase.createClient !== "function") {
    console.error("No está cargado el SDK UMD de Supabase (window.supabase).");
} else {
    window.supabaseClient = window.supabase.createClient(
        window.SUPABASE_URL,
        window.SUPABASE_ANON_KEY,
        {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: true
            }
        }
    );
}
