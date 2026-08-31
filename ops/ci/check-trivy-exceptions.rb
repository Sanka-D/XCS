require 'date'
require 'yaml'

path = ARGV.fetch(0) { abort 'Usage: ruby ops/ci/check-trivy-exceptions.rb <trivyignore.yaml>' }
document = YAML.safe_load(File.read(path), permitted_classes: [Date], aliases: false)
abort 'Trivy exception file must be a mapping' unless document.is_a?(Hash)

allowed_categories = %w[vulnerabilities misconfigurations secrets licenses].freeze
unknown_categories = document.keys - allowed_categories
abort "Unknown Trivy exception categories: #{unknown_categories.join(', ')}" unless unknown_categories.empty?

today = Date.today
maximum_expiry = today + 90
global_path_patterns = ['*', '**', '**/*', '.', '/'].freeze
count = 0

allowed_categories.each do |category|
  entries = document.fetch(category, [])
  abort "#{category} must be an array" unless entries.is_a?(Array)

  entries.each_with_index do |entry, index|
    label = "#{category}[#{index}]"
    abort "#{label} must be a mapping" unless entry.is_a?(Hash)
    unknown_fields = entry.keys - %w[id statement expired_at paths purls]
    abort "#{label} has unknown fields: #{unknown_fields.join(', ')}" unless unknown_fields.empty?

    identifier = entry['id']
    statement = entry['statement']
    expiry = entry['expired_at']
    paths = entry['paths']
    purls = entry['purls']

    abort "#{label}.id is required" unless identifier.is_a?(String) && !identifier.strip.empty?
    unless statement.is_a?(String) && statement.strip.length >= 20
      abort "#{label}.statement must explain the accepted risk in at least 20 characters"
    end
    expiry = Date.iso8601(expiry) if expiry.is_a?(String)
    abort "#{label}.expired_at must be an ISO date" unless expiry.is_a?(Date)
    abort "#{label} is expired" unless expiry > today
    abort "#{label} may not exceed the 90-day review window" unless expiry <= maximum_expiry

    if !paths.nil? &&
       (!paths.is_a?(Array) || paths.empty? || paths.any? { |value| !value.is_a?(String) || value.empty? })
      abort "#{label}.paths must be a non-empty string array"
    end
    if !purls.nil? &&
       (!purls.is_a?(Array) || purls.empty? || purls.any? { |value| !value.is_a?(String) || !value.start_with?('pkg:') })
      abort "#{label}.purls must be a non-empty package-URL string array"
    end
    abort "#{label}.purls is supported only for vulnerabilities" if category != 'vulnerabilities' && !purls.nil?

    if paths&.any? { |value| global_path_patterns.include?(value.strip) }
      abort "#{label}.paths may not contain a repository-wide pattern"
    end

    scoped_paths = paths.is_a?(Array)
    scoped_purls = purls.is_a?(Array)
    abort "#{label} must be narrowed with paths or purls" unless scoped_paths || scoped_purls
    count += 1
  end
end

puts "Validated #{count} bounded Trivy exception(s)."
