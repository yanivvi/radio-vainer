# The studio pushes one mix over the webcast socket. Listeners hear Icecast.
settings.init.allow_root := true
settings.harbor.bind_addrs := ["0.0.0.0"]
settings.harbor.reverse_dns := false

# Auth runs before the mount is claimed. A new studio with the station
# password disconnects the source already holding it, then takes the mount.
release_current = ref(fun () -> ())

def auth(login) =
  if login.user != "source" or login.password != "__PASSWORD__" then
    false
  else
    release = !release_current
    release()
    true
  end
end

# The default buffer is 12s so a crossfade has audio ready. This station does not crossfade.
# The webm decoder delivers a block of about 1.1s. A max of 1s drops that block,
# the Icecast output restarts, and the listener's player loses the mount.
live = input.harbor("live", port=8001, auth=auth, buffer=0.5, max=3.0)

release_current := live.stop

output.icecast(
  %mp3(bitrate=192),
  host="icecast",
  port=8000,
  password="__PASSWORD__",
  mount="/radio-vainer",
  name="Radio Vainer",
  description="Live from the desk.",
  genre="Live",
  public=false,
  fallible=true,
  live
)
