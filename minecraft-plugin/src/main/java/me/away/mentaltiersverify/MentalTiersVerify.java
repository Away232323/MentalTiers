package me.away.mentaltiersverify;

import org.bukkit.Bukkit;
import org.bukkit.ChatColor;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

public final class MentalTiersVerify extends JavaPlugin {
    private HttpClient httpClient;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(getConfig().getInt("request-timeout-seconds", 10)))
                .build();
        getLogger().info("MentalTiersVerify enabled.");
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!(sender instanceof Player player)) {
            sender.sendMessage("This command can only be used by players.");
            return true;
        }

        if (args.length != 1) {
            player.sendMessage(ChatColor.RED + "Usage: /confirm <code>");
            return true;
        }

        final String code = args[0].trim().toUpperCase();
        if (!code.matches("[A-Z0-9]{6}")) {
            player.sendMessage(ChatColor.RED + "That verification code is invalid.");
            return true;
        }

        final String apiUrl = getConfig().getString("api-url", "").trim();
        final String apiSecret = getConfig().getString("api-secret", "").trim();
        if (apiUrl.isBlank() || apiUrl.contains("YOUR-BOT-HOST") || apiSecret.isBlank() || apiSecret.equals("CHANGE-ME")) {
            player.sendMessage(ChatColor.RED + "Verification is not configured yet. Please contact staff.");
            getLogger().warning("api-url/api-secret is not configured in config.yml");
            return true;
        }

        player.sendMessage(ChatColor.YELLOW + "Checking your MentalTiers verification code...");

        Bukkit.getScheduler().runTaskAsynchronously(this, () -> {
            try {
                String body = "{\"code\":\"" + escapeJson(code) + "\","
                        + "\"minecraftName\":\"" + escapeJson(player.getName()) + "\","
                        + "\"uuid\":\"" + player.getUniqueId() + "\"}";

                HttpRequest request = HttpRequest.newBuilder()
                        .uri(URI.create(apiUrl))
                        .timeout(Duration.ofSeconds(getConfig().getInt("request-timeout-seconds", 10)))
                        .header("Content-Type", "application/json")
                        .header("X-MentalTiers-Secret", apiSecret)
                        .POST(HttpRequest.BodyPublishers.ofString(body))
                        .build();

                HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
                String result = response.body() == null ? "SERVER_ERROR" : response.body().trim();

                Bukkit.getScheduler().runTask(this, () -> sendResult(player, result));
            } catch (Exception exception) {
                getLogger().warning("Verification request failed for " + player.getName() + ": " + exception.getMessage());
                Bukkit.getScheduler().runTask(this, () ->
                        player.sendMessage(ChatColor.RED + "Verification server is currently unavailable. Try again shortly."));
            }
        });

        return true;
    }

    private void sendResult(Player player, String result) {
        switch (result) {
            case "OK" -> {
                player.sendMessage(ChatColor.GREEN + "✔ Account verified successfully!");
                player.sendMessage(ChatColor.GRAY + "Your MentalTiers waitlist channels are now unlocked on Discord.");
            }
            case "INVALID_CODE" -> player.sendMessage(ChatColor.RED + "That code does not exist. Generate a new one on Discord.");
            case "EXPIRED" -> player.sendMessage(ChatColor.RED + "That code expired. Generate a new code on Discord.");
            case "NAME_MISMATCH" -> player.sendMessage(ChatColor.RED + "This code belongs to a different Minecraft IGN.");
            case "ALREADY_LINKED" -> player.sendMessage(ChatColor.RED + "This Minecraft account is already linked to another Discord account.");
            case "UNAUTHORIZED" -> player.sendMessage(ChatColor.RED + "Verification bridge is misconfigured. Contact staff.");
            default -> player.sendMessage(ChatColor.RED + "Verification failed (" + result + "). Please contact staff.");
        }
    }

    private static String escapeJson(String value) {
        return value.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
