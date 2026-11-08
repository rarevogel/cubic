package nl.rarevogel.cubic;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.IBinder;

/**
 * Keeps Cubic playing in the background: a media notification with previous / play-pause / next,
 * and a MediaSession so headset and Bluetooth buttons and the lock screen control the player.
 * The audio itself stays in the WebView; this service only keeps the app process in the foreground.
 * (Built against the API 23 jar, so the Android 8+ notification channel is set up by reflection.)
 */
public class PlaybackService extends Service {
    private static final String CHANNEL = "playback";
    private static final int ID = 1;
    static boolean playing;
    static String title = "Cubic", artist = "";
    private MediaSession session;

    static void update(Context c, boolean isPlaying, String t, String a) {
        playing = isPlaying;
        title = t == null || t.isEmpty() ? "Cubic" : t;
        artist = a == null ? "" : a;
        Intent i = new Intent(c, PlaybackService.class).setAction("update");
        try { c.startService(i); } catch (Exception e) { }
    }

    static void stop(Context c) {
        try { c.stopService(new Intent(c, PlaybackService.class)); } catch (Exception e) { }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        if (Build.VERSION.SDK_INT >= 26) {
            try {
                Class<?> nc = Class.forName("android.app.NotificationChannel");
                Object ch = nc.getConstructor(String.class, CharSequence.class, int.class).newInstance(CHANNEL, "Playback", 2 /* IMPORTANCE_LOW */);
                nc.getMethod("setShowBadge", boolean.class).invoke(ch, false);
                NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
                NotificationManager.class.getMethod("createNotificationChannel", nc).invoke(nm, ch);
            } catch (Exception e) { }
        }
        session = new MediaSession(this, "Cubic");
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { send("toggle"); }
            @Override public void onPause() { send("pause"); }
            @Override public void onSkipToNext() { send("next"); }
            @Override public void onSkipToPrevious() { send("prev"); }
            @Override public void onStop() { send("pause"); }
        });
        session.setActive(true);
    }

    private void send(final String action) {
        final MainActivity a = MainActivity.current;
        if (a != null) a.runOnUiThread(new Runnable() { public void run() { a.media(action); } });
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String act = intent == null ? null : intent.getAction();
        if ("toggle".equals(act) || "next".equals(act) || "prev".equals(act)) { send(act); return START_NOT_STICKY; }
        if ("dismiss".equals(act)) { stopSelf(); return START_NOT_STICKY; }
        session.setMetadata(new MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, title)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, artist).build());
        session.setPlaybackState(new PlaybackState.Builder()
                .setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE
                        | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS)
                .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED, PlaybackState.PLAYBACK_POSITION_UNKNOWN, 1f).build());
        Notification n = build();
        if (playing) startForeground(ID, n);
        else {
            stopForeground(false);
            ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).notify(ID, n);
        }
        return START_NOT_STICKY;
    }

    private PendingIntent action(String a, int req) {
        return PendingIntent.getService(this, req, new Intent(this, PlaybackService.class).setAction(a),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    @SuppressWarnings("deprecation")
    private Notification build() {
        Notification.Builder b = new Notification.Builder(this)
                .setSmallIcon(R.drawable.ic_stat)
                .setContentTitle(title)
                .setContentText(artist)
                .setOngoing(playing)
                .setShowWhen(false)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setDeleteIntent(action("dismiss", 4))
                .setContentIntent(PendingIntent.getActivity(this, 0,
                        new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE))
                .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_previous, "Previous", action("prev", 1)).build())
                .addAction(new Notification.Action.Builder(playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
                        playing ? "Pause" : "Play", action("toggle", 2)).build())
                .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_next, "Next", action("next", 3)).build())
                .setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0, 1, 2));
        if (Build.VERSION.SDK_INT >= 26) {
            try { Notification.Builder.class.getMethod("setChannelId", String.class).invoke(b, CHANNEL); } catch (Exception e) { }
        }
        return b.build();
    }

    @Override
    public void onDestroy() {
        stopForeground(true);
        if (session != null) session.release();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent i) { return null; }
}
