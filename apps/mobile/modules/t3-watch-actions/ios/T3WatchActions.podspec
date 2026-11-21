Pod::Spec.new do |s|
  s.name = 'T3WatchActions'
  s.version = '1.0.0'
  s.summary = 'Notification buttons that answer the T3 server from the lock screen or Apple Watch.'
  s.description = 'Registers the approval and next-action notification categories and posts a pressed button straight to the server that sent the push, without starting the JS app.'
  s.author = 'T3 Tools'
  s.homepage = 'https://t3tools.com'
  s.platform = :ios, '18.0'
  s.source = { :path => '.' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.dependency 'ExpoNotifications'
  s.source_files = '*.swift'
end
