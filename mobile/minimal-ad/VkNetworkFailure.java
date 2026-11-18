package com.voiddominion.adprobe;

import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Extracts fixed fields from the SDK callback without retaining the source text. */
final class VkNetworkFailure {
    private static final Pattern STATUS = Pattern.compile("^(-1|0|[1-5][0-9]{2}) [–-] ");

    final String kind;
    final Integer httpStatus;

    private VkNetworkFailure(String kind, Integer httpStatus) {
        this.kind = kind;
        this.httpStatus = httpStatus;
    }

    static VkNetworkFailure fromMessage(String message) {
        if (message == null) return new VkNetworkFailure("unknown", null);
        // In SDK 5.52.5 the 1000 callback can start with the response code,
        // or -1 when the transport failed before getting a status.
        String bounded = message.substring(0, Math.min(message.length(), 512));
        Matcher status = STATUS.matcher(bounded);
        if (status.find()) {
            int value = Integer.parseInt(status.group(1));
            if (value >= 100) return new VkNetworkFailure("http", value);
            bounded = bounded.substring(status.end());
        }
        return new VkNetworkFailure(transportKind(bounded.toLowerCase(Locale.ROOT)), null);
    }

    private static String transportKind(String text) {
        if (text.contains("cleartext") && text.contains("not permitted")) return "cleartext_blocked";
        if (text.contains("unable to resolve host") || text.contains("unknownhostexception") ||
            text.contains("name or service not known") || text.contains("no address associated with hostname")) return "dns";
        if (text.contains("sslhandshakeexception") || text.contains("certificate") ||
            text.contains("trust anchor") || text.contains("handshake failed") || text.contains("ssl protocol")) return "tls";
        if (text.contains("timed out") || text.contains("timeout")) return "timeout";
        if (text.contains("failed to connect") || text.contains("connection refused") ||
            text.contains("network is unreachable") || text.contains("connection reset")) return "connect";
        return "unknown";
    }
}
