# The studio pushes one mix over the webcast socket. Listeners hear Icecast.
settings.init.allow_root := true
settings.harbor.bind_addrs := ["0.0.0.0"]
settings.harbor.reverse_dns := false

live = input.harbor("live", port=8001, password="__PASSWORD__", user="source")

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
