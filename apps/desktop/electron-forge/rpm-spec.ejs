%define _binary_payload w<%= compressionLevel %>.xzdio

%if "%{_host_cpu}" != "%{_target_cpu}"
%global __strip /bin/true
%endif

Name: <%= name %>
Version: <%= version %>
Release: <%= revision %>%{?dist}
<% if (description) { print(`Summary: ${description}\n`) }
%>
<% if (license) { print(`License: ${license}\n`) }
if (homepage) { print(`URL: ${homepage}\n`) }
if (license || homepage) { print('\n') }

%>Requires: <%= requires.join(', ') %>
AutoReqProv: no

<% if (productDescription) {
%>%description
<% print(productDescription)
print('\n\n\n') }


%>%install
mkdir -p %{buildroot}/usr/
cp <%= process.platform === 'darwin' ? '-R' : '-r' %> %{_topdir}/BUILD/usr/* %{buildroot}/usr/


%files
/usr/bin/<%= name %>
/usr/lib/<%= name %>/
/usr/share/applications/<%= name %>.desktop
/usr/share/doc/<%= name %>/
<% if (_.isObject(icon)) {
  _.forEach(icon, function (path, resolution) {
    %>/usr/share/icons/hicolor/<%= resolution %>/apps/<%= name %><%= resolution === 'symbolic' ? '-symbolic' : '' %>.<%= ['scalable', 'symbolic'].includes(resolution) ? 'svg' : 'png' %>
<% }) } else {
  %>/usr/share/pixmaps/<%= name %>.png
<% } %>

<% if (pre) {
  %>%pre
<% print(pre)
if (preun || post || postun) print('\n\n\n') }


%><% if (preun) {
  %>%preun
<% print(preun)
if (post || postun) print('\n\n\n') }


%><% if (post) {
  %>%post
<% print(post)
if (postun) print('\n\n\n') }


%><% if (postun) {
  %>%postun
<% print(postun) } %>
